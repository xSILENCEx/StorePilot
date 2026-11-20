import { z } from "zod";
import {
  CheckError,
  googleAccessToken,
  storeRequest,
} from "./connection-check";
import { configFields } from "./config-model";
import type { GoogleSnapshot } from "./apple-sync-model";

import { googleScreenshotDevices } from "./screenshot-groups";

const listing = z.object({
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
  title: z.string().default(""),
  shortDescription: z.string().default(""),
  fullDescription: z.string().default(""),
  video: z.string().default(""),
});
const imageList = z.object({
  images: z
    .array(z.object({ id: z.string().min(1), url: z.url() }))
    .default([]),
});

export async function readGoogleSnapshot(
  config: { fields: unknown; secret: string },
  fetcher = fetch,
  report: (step: string, message: string) => void = () => {},
): Promise<GoogleSnapshot> {
  const { packageName } = configFields.google.parse(config.fields);
  report("google_auth", "向 Google OAuth 请求访问令牌");
  const token = await googleAccessToken(config.secret, fetcher);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const request = storeRequest.bind(null, fetcher);
  async function read(url: string, stage: string, label: string) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await request(url, { headers }, stage);
      } catch (error) {
        if (!(error instanceof CheckError)) throw error;
        if (error.status !== 503 || attempt >= 3)
          throw new CheckError(
            stage,
            label + "失败：" + error.message,
            error.status,
          );
        report(stage, label + "返回 HTTP 503，稍后重试（" + attempt + "/2）");
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  report("google_edit", "OAuth 鉴权成功，创建临时 edit");
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits`;
  const edit = await request(
    base,
    { method: "POST", headers, body: "{}" },
    "google_edit",
  );
  const id = z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,200}$/)
    .parse(edit.id);
  const url = base + "/" + id;
  try {
    report("google_listings", "临时 edit 已创建，读取本地化详情");
    const { listings } = z
      .object({ listings: z.array(listing).default([]) })
      .parse(
        await read(url + "/listings", "google_listings", "读取本地化详情"),
      );
    const locales: GoogleSnapshot["locales"] = {};
    for (const item of listings) {
      const screenshots: GoogleSnapshot["locales"][string]["screenshots"] = [];
      report("google_images", "读取 " + item.language + " 的各设备截图列表");
      for (const deviceType of Object.keys(googleScreenshotDevices)) {
        const { images } = imageList.parse(
          await read(
            `${url}/listings/${item.language}/${deviceType}`,
            "google_images",
            `读取 ${item.language} / ${deviceType} 截图列表`,
          ),
        );
        for (const image of images)
          screenshots.push({
            id: image.id,
            assetId: image.id,
            deviceType,
            fileName: image.id,
            width: 0,
            height: 0,
            state: "available",
            sourceUrl: image.url,
            url: null,
          });
      }
      locales[item.language] = {
        draft: {
          title: item.title,
          subtitle: item.shortDescription,
          description: item.fullDescription,
          video: item.video,
          keywords: "",
          images: [],
        },
        screenshots,
      };
    }
    return {
      packageName,
      locales,
      fetchedAt: new Date().toISOString(),
      warnings: [],
    };
  } finally {
    try {
      await request(url, { headers, method: "DELETE" }, "google_cleanup");
    } catch (error) {
      throw new CheckError(
        "google_cleanup",
        `临时 edit ${id} 清理失败，${error instanceof CheckError ? error.message : "请检查 Google Play 后重试。"}`,
      );
    }
  }
}
