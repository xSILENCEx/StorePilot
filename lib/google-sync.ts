import { createGoogleEdit, deleteGoogleEdit } from "./google-edit";
import { z } from "zod";
import {
  CheckError,
  googleAccessToken,
  storeRequest,
} from "./connection-check";
import { configFields } from "./config-model";
import type { GoogleSnapshot } from "./apple-sync-model";

import { graphicTypes, type GraphicType } from "./model";
import { googleScreenshotDevices } from "./screenshot-groups";

const appDetails = z.object({
  defaultLanguage: z.string().optional(),
  contactWebsite: z.string().optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
});
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

// Play returns a preview URL. Request the full-size graphic from Google's image CDN.
function graphicSourceUrl(raw: string) {
  const url = new URL(raw);
  if (
    url.protocol === "https:" &&
    url.hostname.endsWith(".googleusercontent.com")
  ) {
    url.pathname = url.pathname.replace(/=(?:s|w|h)\d+[\w-]*$/, "") + "=s0";
    return url.href;
  }
  return raw;
}

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
  const { id, url } = await createGoogleEdit(packageName, headers, request);
  try {
    report("google_details", "读取应用默认语言和公开联系方式");
    const details = appDetails.parse(
      await read(url + "/details", "google_details", "读取应用信息"),
    );
    report("google_listings", "读取本地化详情");
    const { listings } = z
      .object({ listings: z.array(listing).default([]) })
      .parse(
        await read(url + "/listings", "google_listings", "读取本地化详情"),
      );
    const locales: GoogleSnapshot["locales"] = {};
    for (const item of listings) {
      const screenshots: GoogleSnapshot["locales"][string]["screenshots"] = [];
      report("google_images", "读取 " + item.language + " 的各设备截图列表");
      const graphics: NonNullable<
        GoogleSnapshot["locales"][string]["graphics"]
      > = {};
      for (const deviceType of [
        ...Object.keys(googleScreenshotDevices),
        ...graphicTypes,
      ]) {
        const { images } = imageList.parse(
          await read(
            `${url}/listings/${item.language}/${deviceType}`,
            "google_images",
            `读取 ${item.language} / ${deviceType} 图片列表`,
          ),
        );
        for (const image of images) {
          const stored = {
            id: image.id,
            assetId: image.id,
            deviceType,
            fileName: image.id,
            width: 0,
            height: 0,
            state: "available",
            sourceUrl: Object.hasOwn(googleScreenshotDevices, deviceType)
              ? image.url
              : graphicSourceUrl(image.url),
            url: null,
          };
          if (Object.hasOwn(googleScreenshotDevices, deviceType))
            screenshots.push(stored);
          else graphics[deviceType as GraphicType] = stored;
        }
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
        graphics,
      };
    }
    return {
      packageName,
      icon:
        locales[details.defaultLanguage ?? ""]?.graphics?.icon ??
        Object.values(locales).find((entry) => entry.graphics?.icon)?.graphics
          ?.icon,
      details,
      locales,
      fetchedAt: new Date().toISOString(),
      warnings: [],
    };
  } finally {
    try {
      await deleteGoogleEdit(url, headers, request);
    } catch (error) {
      throw new CheckError(
        "google_cleanup",
        `临时 edit ${id} 清理失败，${error instanceof CheckError ? error.message : "请检查 Google Play 后重试。"}`,
      );
    }
  }
}
