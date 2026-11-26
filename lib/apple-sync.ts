import { maxImagePixels } from "./asset-reference";
import { localeCode } from "./store-locales";
import { blankDraft } from "./model";
import { appleToken } from "./store-token";
import { parseAppleDeviceCatalog } from "./apple-device-catalog";
import { z } from "zod";
import { configFields } from "./config-model";
import { draftSchema } from "./model";
import type { AppleSnapshot } from "./apple-sync-model";
import {
  appleReader,
  AppleReadError,
  resource,
  type Resource,
} from "./apple-reader";
export { appleToken } from "./store-token";
export { AppleReadError } from "./apple-reader";
export async function readAppleSnapshot(
  config: { fields: unknown; secret: string },
  appInfoId = "",
  fetcher: typeof fetch = fetch,
  forWrite = false,
): Promise<AppleSnapshot> {
  const fields = configFields.apple.parse(config.fields);
  const { request, list, included } = appleReader(appleToken(config), fetcher);
  const app = resource.parse(
    (await request(`/v1/apps/${encodeURIComponent(fields.appId)}`)).data,
  );
  if (app.id !== fields.appId || app.attributes.bundleId !== fields.bundleId)
    throw new AppleReadError("Apple 应用 ID / Bundle ID 与连接设置不匹配。");
  const versionQuery = new URLSearchParams({
    "filter[platform]": fields.appPlatform,
    limit: "200",
  });
  if (fields.version) versionQuery.set("filter[versionString]", fields.version);
  const versions = (
    await list(`/v1/apps/${fields.appId}/appStoreVersions?${versionQuery}`)
  ).filter(
    (v) =>
      v.attributes.platform === fields.appPlatform &&
      (!fields.version || v.attributes.versionString === fields.version),
  );
  const editable = versions.filter((v) =>
    [
      "PREPARE_FOR_SUBMISSION",
      "DEVELOPER_REJECTED",
      "REJECTED",
      "METADATA_REJECTED",
    ].includes(state(v)),
  );
  if (forWrite && editable.length !== 1)
    throw new AppleReadError(
      "未找到唯一可编辑版本，请在 App Store Connect 创建版本或在连接设置指定版本号",
    );
  const version = forWrite
    ? editable[0]
    : selectVersion(versions, fields.version);
  const infos = await list(`/v1/apps/${fields.appId}/appInfos?limit=200`);
  const info = selectInfo(infos, version, appInfoId);
  const infoLocales = await list(
    `/v1/appInfos/${encodeURIComponent(info.id)}/appInfoLocalizations?limit=200`,
  );
  const versionLocales = await list(
    `/v1/appStoreVersions/${encodeURIComponent(version.id)}/appStoreVersionLocalizations?limit=200`,
  );
  const locales: AppleSnapshot["locales"] = {};
  for (const [rows, level] of [
    [infoLocales, "info"],
    [versionLocales, "version"],
  ] as const) {
    const seen = new Set<string>();
    for (const row of rows) {
      const locale = localeCode.parse(row.attributes.locale);
      if (seen.has(locale))
        throw new AppleReadError("Apple 返回重复语言，未更新快照。");
      seen.add(locale);
      const entry = (locales[locale] ??= {
        draft: blankDraft(),
        screenshots: [],
        appInfoLocalizationId: null,
        versionLocalizationId: null,
      });
      const text = (key: string) =>
        z.string().nullable().optional().parse(row.attributes[key]) ?? "";
      if (level === "info") {
        entry.draft.title = text("name");
        entry.draft.subtitle = text("subtitle");
        entry.draft.privacyPolicyUrl = text("privacyPolicyUrl");
        entry.draft.privacyChoicesUrl = text("privacyChoicesUrl");
        entry.appInfoLocalizationId = row.id;
      } else {
        entry.draft.description = text("description");
        entry.draft.keywords = text("keywords");
        for (const field of [
          "promotionalText",
          "whatsNew",
          "supportUrl",
          "marketingUrl",
        ] as const)
          entry.draft[field] = text(field);
        entry.versionLocalizationId = row.id;
      }
      draftSchema.parse(entry.draft);
    }
  }
  const warnings: string[] = [];
  for (const [locale, entry] of Object.entries(locales)) {
    if (!entry.versionLocalizationId) continue;
    const id = encodeURIComponent(entry.versionLocalizationId);
    let placements: Resource[] | null = null;
    try {
      placements = await list(
        `/v1/appStoreVersionLocalizations/${id}/placements?sort=placementGroupPosition&include=image&limit=200`,
      );
    } catch (error) {
      if (
        !(error instanceof AppleReadError) ||
        ![404, 405].includes(error.status ?? 0)
      )
        throw error;
    }
    if (placements?.length) {
      for (const placement of placements) {
        if (
          !["APP_SCREENSHOT", "IMESSAGE_APP_SCREENSHOT"].includes(
            String(placement.attributes.placementType),
          )
        )
          continue;
        const imageId = relatedId(placement, "image");
        if (!imageId)
          throw new AppleReadError(
            "Apple 截图未提供素材关联，未更新资料快照。",
          );
        let image = included.get(`appAssetLibraryImages:${imageId}`);
        if (!image)
          image = resource.parse(
            (
              await request(
                `/v1/appAssetLibraryImages/${encodeURIComponent(imageId)}`,
              )
            ).data,
          );
        entry.screenshots.push(
          screenshot(
            placement.id,
            image,
            String(placement.attributes.placementGroup ?? "UNKNOWN"),
          ),
        );
      }
    } else {
      // Existing apps can still expose screenshots through the deprecated set API.
      // Use it only when the new placements relationship is unavailable or empty.
      const sets = await list(
        `/v1/appStoreVersionLocalizations/${id}/appScreenshotSets?limit=200`,
      );
      for (const set of sets) {
        const images = await list(
          `/v1/appScreenshotSets/${encodeURIComponent(set.id)}/appScreenshots?limit=200`,
        );
        for (const image of images)
          entry.screenshots.push(
            screenshot(
              image.id,
              image,
              String(set.attributes.screenshotDisplayType ?? "UNKNOWN"),
            ),
          );
      }
    }
    if (entry.screenshots.some((image) => !image.sourceUrl))
      warnings.push(`${locale} 有尚未处理完成的截图，已保留状态，暂不可下载。`);
  }
  let deviceGroups;
  try {
    const rows = await list(
      "/v1/appAssetLibraryRefData?fields[appAssetLibraryRefData]=features,placementProfileGroups",
    );
    if (rows.length) deviceGroups = parseAppleDeviceCatalog(rows[0].attributes);
  } catch {
    warnings.push("设备目录读取失败，编辑器可继续使用公开规格分组。");
  }
  let icon: AppleSnapshot["icon"];
  try {
    const buildData = (
      await request(
        `/v1/appStoreVersions/${encodeURIComponent(version.id)}/build?fields[builds]=iconAssetToken`,
      )
    ).data;
    if (buildData) {
      const build = resource.parse(buildData);
      if (build.attributes.iconAssetToken)
        icon = screenshot(
          build.id,
          build,
          "icon",
          build.attributes.iconAssetToken,
        );
    }
  } catch (error) {
    if (!(error instanceof AppleReadError) || error.status !== 404) throw error;
  }
  return {
    icon,
    deviceGroups,
    metadata: {
      name: stringAttribute(app, "name"),
      primaryLocale: stringAttribute(app, "primaryLocale"),
      sku: stringAttribute(app, "sku"),
      copyright: stringAttribute(version, "copyright"),
      releaseType: stringAttribute(version, "releaseType"),
      earliestReleaseDate: stringAttribute(version, "earliestReleaseDate"),
      primaryCategoryId: relatedId(info, "primaryCategory") ?? "",
      secondaryCategoryId: relatedId(info, "secondaryCategory") ?? "",
      ageRating: stringAttribute(info, "appStoreAgeRating"),
    },
    warnings,
    target: {
      appId: fields.appId,
      bundleId: fields.bundleId,
      platform: fields.appPlatform,
      version: String(version.attributes.versionString),
      versionId: version.id,
      versionState: String(
        version.attributes.appVersionState ??
          version.attributes.appStoreState ??
          "",
      ),
      appInfoId: info.id,
      appInfoState: String(
        info.attributes.state ?? info.attributes.appStoreState ?? "",
      ),
    },
    locales,
    fetchedAt: new Date().toISOString(),
  };
}

function stringAttribute(row: Resource, key: string) {
  return z.string().nullable().optional().parse(row.attributes[key]) ?? "";
}
function relatedId(row: Resource, name: string) {
  const value = row.relationships?.[name];
  if (!value) return null;
  return (
    z
      .object({ data: z.object({ id: z.string() }).nullable().optional() })
      .parse(value).data?.id ?? null
  );
}
function state(row: Resource) {
  return String(
    row.attributes.appVersionState ??
      row.attributes.state ??
      row.attributes.appStoreState ??
      "",
  );
}
const published = new Set(["READY_FOR_DISTRIBUTION", "READY_FOR_SALE"]);
const removed = new Set([
  "REMOVED_FROM_SALE",
  "DEVELOPER_REMOVED_FROM_SALE",
  "REPLACED_WITH_NEW_VERSION",
]);
function versionPriority(version: Resource) {
  const status = state(version);
  return published.has(status) ? 1 : removed.has(status) ? 2 : 0;
}
function selectVersion(versions: Resource[], requested: string) {
  if (!versions.length)
    throw new AppleReadError(
      requested
        ? "未找到指定平台的目标版本，请检查版本号。"
        : "该平台尚无 App Store 版本，请先在 App Store Connect 创建版本。",
    );
  if (requested) {
    if (versions.length !== 1)
      throw new AppleReadError("目标版本不唯一，请检查平台和版本配置。");
    return versions[0];
  }
  return [...versions].sort(
    (a, b) =>
      versionPriority(a) - versionPriority(b) ||
      String(b.attributes.versionString).localeCompare(
        String(a.attributes.versionString),
        "en",
        { numeric: true },
      ) ||
      String(b.attributes.createdDate ?? "").localeCompare(
        String(a.attributes.createdDate ?? ""),
      ),
  )[0];
}
function selectInfo(infos: Resource[], version: Resource, requested: string) {
  if (requested) {
    const found = infos.find((info) => info.id === requested);
    if (found) return found;
    throw new AppleReadError("指定的应用资料 ID 不存在，请检查高级选项。");
  }
  if (infos.length === 1) return infos[0];
  const matches = infos.filter((info) =>
    published.has(state(version))
      ? published.has(state(info))
      : state(info) === state(version),
  );
  if (matches.length === 1) return matches[0];
  throw new AppleReadError(
    `无法唯一确定应用资料，请在高级选项中指定：${infos.map((info) => `${info.id}（${state(info)}）`).join("；")}`,
  );
}
function screenshot(
  id: string,
  image: Resource,
  deviceType: string,
  imageAsset = image.attributes.imageAsset,
): AppleSnapshot["locales"][string]["screenshots"][number] {
  const asset = z
    .object({
      templateUrl: z.string(),
      width: z.number().int().positive().max(10000),
      height: z.number().int().positive().max(10000),
    })
    .nullable()
    .optional()
    .parse(imageAsset);
  let sourceUrl: string | null = null;
  if (asset) {
    const url = new URL(
      asset.templateUrl
        .replaceAll("{w}", String(asset.width))
        .replaceAll("{h}", String(asset.height))
        .replaceAll("{f}", "png"),
    );
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !(
        url.hostname === "mzstatic.com" ||
        url.hostname.endsWith(".mzstatic.com")
      ) ||
      /[{}]|%7B|%7D/i.test(url.href) ||
      asset.width * asset.height > maxImagePixels
    )
      throw new AppleReadError("Apple 截图地址或尺寸不可信，已停止同步。");
    sourceUrl = url.href;
  }
  const delivery = image.attributes.assetDeliveryState as
    { state?: string } | undefined;
  return {
    id,
    assetId: image.id,
    deviceType,
    fileName:
      stringAttribute(image, "fileName") ||
      stringAttribute(image, "referenceName"),
    width: asset?.width ?? 0,
    height: asset?.height ?? 0,
    state: stringAttribute(image, "state") || delivery?.state || "UNKNOWN",
    sourceUrl,
    url: null,
  };
}
