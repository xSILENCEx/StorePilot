import { createHash } from "node:crypto";
import { z } from "zod";
import { appleToken, readAppleSnapshot } from "./apple-sync";
import { storeRequest } from "./connection-check";
import type { PushEntry, LoadAsset } from "./google-push";
import { assertWorkerActive } from "./worker-context";
const resource = z.object({
  id: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).default({}),
});
const rel = (type: string, id: string) => ({ data: { type, id } });
const operations = z
  .array(
    z.object({
      method: z.literal("PUT"),
      url: z.url(),
      offset: z.number().int().nonnegative(),
      length: z.number().int().positive(),
      requestHeaders: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .nullish(),
    }),
  )
  .min(1);
export async function pushApple(
  config: { fields: unknown; secret: string },
  entries: PushEntry[],
  asset: LoadAsset,
  report: (message: string) => void,
  fetcher = fetch,
) {
  const snapshot = await readAppleSnapshot(config, "", fetcher, true);
  const { versionId, appInfoId, version, appId } = snapshot.target;
  report("目标版本 " + version);
  async function api(path: string, method = "GET", data?: unknown) {
    assertWorkerActive();
    return storeRequest(
      fetcher,
      "https://api.appstoreconnect.apple.com/v1/" + path,
      {
        method,
        headers: {
          Authorization: "Bearer " + appleToken(config),
          "Content-Type": "application/json",
        },
        body: data ? JSON.stringify({ data }) : undefined,
      },
      "apple_push",
    );
  }
  async function create(
    type: string,
    attributes: Record<string, unknown>,
    relationships: Record<string, unknown>,
  ) {
    return resource.parse(
      (await api(type, "POST", { type, attributes, relationships })).data,
    );
  }
  async function localization(
    type: string,
    id: string | null | undefined,
    locale: string,
    attributes: Record<string, string>,
    parent: Record<string, unknown>,
  ) {
    if (id) {
      if (Object.keys(attributes).length)
        await api(type + "/" + encodeURIComponent(id), "PATCH", {
          type,
          id,
          attributes,
        });
      return id;
    }
    return (await create(type, { locale, ...attributes }, parent)).id;
  }
  async function upload(
    type: string,
    src: string,
    parent: Record<string, unknown>,
    library: boolean,
  ) {
    const { bytes, mime } = await asset(src);
    const reserved = await create(
      type,
      {
        fileName:
          src.split("/").pop() + (mime === "image/png" ? ".png" : ".jpg"),
        fileSize: bytes.length,
        ...(library ? { category: "APP_SCREENSHOTS_AND_PREVIEWS" } : {}),
      },
      parent,
    );
    const parts = operations
      .parse(reserved.attributes.uploadOperations)
      .sort((a, b) => a.offset - b.offset);
    let offset = 0;
    for (const part of parts) {
      assertWorkerActive();
      const target = new URL(part.url);
      if (
        target.protocol !== "https:" ||
        target.username ||
        target.password ||
        part.offset !== offset ||
        offset + part.length > bytes.length
      )
        throw new Error("Apple 返回的分片上传参数无效");
      const response = await fetcher(target, {
        method: part.method,
        headers: Object.fromEntries(
          (part.requestHeaders ?? []).map((h) => [h.name, h.value]),
        ),
        body: new Uint8Array(bytes.subarray(offset, offset + part.length)),
        redirect: "error",
        signal: AbortSignal.timeout(90000),
      });
      await response.body?.cancel();
      if (!response.ok)
        throw new Error(
          "Apple 素材分片上传失败（HTTP " + response.status + "）",
        );
      offset += part.length;
    }
    if (offset !== bytes.length) throw new Error("素材分片长度不完整");
    const path = type + "/" + encodeURIComponent(reserved.id);
    const committed = await api(path, "PATCH", {
      type,
      id: reserved.id,
      attributes: {
        uploaded: true,
        ...(library
          ? {}
          : {
              sourceFileChecksum: createHash("md5").update(bytes).digest("hex"),
            }),
      },
    });
    let result = resource.parse(committed.data);
    for (let n = 0; n < 45; n++) {
      const delivery = result.attributes.assetDeliveryState as
        { state?: string } | undefined;
      const state = String(result.attributes.state ?? delivery?.state ?? "");
      if (
        [
          "COMPLETE",
          "PREPARE_FOR_SUBMISSION",
          "READY_FOR_REVIEW",
          "APPROVED",
          "ACCEPTED",
        ].includes(state)
      )
        return reserved.id;
      if (["FAILED", "REJECTED"].includes(state))
        throw new Error("Apple 素材处理失败");
      await new Promise((r) => setTimeout(r, 2000));
      result = resource.parse((await api(path)).data);
    }
    throw new Error("Apple 素材仍在处理，请同步确认后再推送");
  }
  let libraryId = "";
  for (const { locale, fields, groups } of entries) {
    const entry = snapshot.locales[locale];
    const info: Record<string, string> = {},
      ver: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (entry?.draft[key as keyof typeof entry.draft] === value) continue;
      if (
        ["title", "subtitle", "privacyPolicyUrl", "privacyChoicesUrl"].includes(
          key,
        )
      )
        info[key === "title" ? "name" : key] = value;
      else ver[key] = value;
    }
    report(locale + " · 更新本地化资料");
    if (Object.keys(info).length || !entry?.appInfoLocalizationId) {
      if (!entry?.appInfoLocalizationId && !info.name)
        throw new Error(locale + " 新语言需要填写应用名称并选择商店文案");
      await localization(
        "appInfoLocalizations",
        entry?.appInfoLocalizationId,
        locale,
        info,
        { appInfo: rel("appInfos", appInfoId) },
      );
    }
    const locId = await localization(
      "appStoreVersionLocalizations",
      entry?.versionLocalizationId,
      locale,
      ver,
      { appStoreVersion: rel("appStoreVersions", versionId) },
    );
    for (const [group, urls] of Object.entries(groups)) {
      report(locale + " · 替换 " + group + " 截图（" + urls.length + " 张）");
      const locPath =
        "appStoreVersionLocalizations/" + encodeURIComponent(locId);
      const old =
        entry?.screenshots.filter((s) => s.deviceType === group) ?? [];
      if (
        old.length === urls.length &&
        old.every(
          (s, i) => s.fileName.split(".")[0] === urls[i].split("/").pop(),
        )
      )
        continue;
      // Legacy display types and asset library placement profiles have separate APIs.
      if (/^(APP_|IMESSAGE_APP_)/.test(group)) {
        const sets = z
          .array(resource)
          .parse((await api(locPath + "/appScreenshotSets?limit=200")).data);
        const set =
          sets.find((s) => s.attributes.screenshotDisplayType === group) ??
          (await create(
            "appScreenshotSets",
            { screenshotDisplayType: group },
            {
              appStoreVersionLocalization: rel(
                "appStoreVersionLocalizations",
                locId,
              ),
            },
          ));
        for (const image of old)
          await api("appScreenshots/" + encodeURIComponent(image.id), "DELETE");
        const ids = [];
        for (const src of urls)
          ids.push(
            await upload(
              "appScreenshots",
              src,
              { appScreenshotSet: rel("appScreenshotSets", set.id) },
              false,
            ),
          );
        await api(
          "appScreenshotSets/" +
            encodeURIComponent(set.id) +
            "/relationships/appScreenshots",
          "PATCH",
          ids.map((id) => ({ type: "appScreenshots", id })),
        );
        continue;
      }
      const catalog = snapshot.deviceGroups ?? [];
      const profile =
        catalog.find((d) => d.value === group)?.value ??
        catalog.find((d) => d.value === group.replace(/_DISPLAY$/, "_PROFILE"))
          ?.value ??
        group;
      if (!libraryId)
        libraryId = resource.parse(
          (await api("apps/" + appId + "/assetLibrary")).data,
        ).id;
      const ids = [];
      for (const src of urls)
        ids.push(
          await upload(
            "appAssetLibraryImages",
            src,
            { assetLibrary: rel("appAssetLibraries", libraryId) },
            true,
          ),
        );
      for (const placement of entry?.screenshots.filter(
        (s) => s.deviceType === profile,
      ) ?? [])
        await api(
          "appAssetLibraryPlacements/" + encodeURIComponent(placement.id),
          "DELETE",
        );
      const ordered = [];
      for (const id of ids) {
        const placement = await create(
          "appAssetLibraryPlacements",
          {
            placementGroup: profile,
            placementType: profile.includes("IMESSAGE")
              ? "IMESSAGE_APP_SCREENSHOT"
              : "APP_SCREENSHOT",
          },
          {
            image: rel("appAssetLibraryImages", id),
            appStoreVersionLocalization: rel(
              "appStoreVersionLocalizations",
              locId,
            ),
          },
        );
        ordered.push({ type: "appAssetLibraryPlacements", id: placement.id });
      }
      await api("appAssetLibraryPlacementOrderingRequests", "POST", {
        type: "appAssetLibraryPlacementOrderingRequests",
        attributes: { placementGroup: profile },
        relationships: {
          appStoreVersionLocalization: rel(
            "appStoreVersionLocalizations",
            locId,
          ),
          orderedPlacements: { data: ordered },
        },
      });
    }
  }
}
