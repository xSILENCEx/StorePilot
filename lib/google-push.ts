import { z } from "zod";
import {
  CheckError,
  googleAccessToken,
  storeRequest,
} from "./connection-check";
import type { PushContent } from "./push-plan";
import { assertWorkerActive } from "./worker-context";
export type PushEntry = PushContent & { locale: string };
export type LoadAsset = (
  url: string,
) => Promise<{ bytes: Buffer; mime: string }>;
export async function pushGoogle(
  packageName: string,
  secret: string,
  entries: PushEntry[],
  asset: LoadAsset,
  report: (message: string) => void,
  fetcher = fetch,
) {
  const token = await googleAccessToken(secret, fetcher);
  const base =
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
    encodeURIComponent(packageName) +
    "/edits";
  async function send(
    url: string,
    method: string,
    body?: BodyInit,
    mime = "application/json",
  ) {
    assertWorkerActive();
    return storeRequest(
      fetcher,
      url,
      {
        method,
        headers: { Authorization: "Bearer " + token, "Content-Type": mime },
        body,
      },
      "google_push",
    );
  }
  const edit = await send(base, "POST", "{}");
  const url = base + "/" + encodeURIComponent(z.string().min(1).parse(edit.id));
  let committing = false;
  try {
    const listings = z
      .array(
        z.object({
          language: z.string(),
          title: z.string().optional(),
          shortDescription: z.string().optional(),
          fullDescription: z.string().optional(),
          video: z.string().optional(),
        }),
      )
      .parse((await send(url + "/listings", "GET")).listings ?? []);
    for (const { locale, fields, groups } of entries) {
      report(locale + " · 写入临时 edit");
      const path = url + "/listings/" + encodeURIComponent(locale);
      const listing = {
        ...listings.find((l) => l.language === locale),
        language: locale,
      };
      if (fields.title) listing.title = fields.title;
      if (fields.subtitle) listing.shortDescription = fields.subtitle;
      if (fields.description) listing.fullDescription = fields.description;
      if (fields.video) listing.video = fields.video;
      if (Object.keys(fields).length)
        await send(path, "PUT", JSON.stringify(listing));
      for (const [group, urls] of Object.entries(groups)) {
        const images = path + "/" + encodeURIComponent(group);
        await send(images, "DELETE");
        for (const src of urls) {
          const { bytes, mime } = await asset(src);
          const result = await send(
            images.replace(
              "/androidpublisher/v3",
              "/upload/androidpublisher/v3",
            ) + "?uploadType=media",
            "POST",
            new Uint8Array(bytes),
            mime,
          );
          if (!result.image) throw new Error("Google 未确认图片上传");
        }
      }
    }
    await send(url + ":validate", "POST");
    report("Google 校验通过，提交商店资料");
    committing = true;
    await send(
      url + ":commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW",
      "POST",
    );
  } catch (error) {
    if (
      !committing ||
      (error instanceof CheckError && error.status && error.status < 500)
    ) {
      try {
        await send(url, "DELETE");
      } catch (cleanup) {
        if (!(
          cleanup instanceof CheckError &&
          (cleanup.status === 404 || cleanup.status === 410)
        ))
          throw new Error(
            `Google 推送失败，临时 edit ${edit.id} 清理状态待核对`,
          );
      }
    }
    throw error;
  }
}
