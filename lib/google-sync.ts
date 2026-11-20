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
): Promise<GoogleSnapshot> {
  const { packageName } = configFields.google.parse(config.fields);
  const token = await googleAccessToken(config.secret, fetcher);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const request = storeRequest.bind(null, fetcher);
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
    const { listings } = z
      .object({ listings: z.array(listing).default([]) })
      .parse(await request(url + "/listings", { headers }, "google_listings"));
    const locales: GoogleSnapshot["locales"] = {};
    for (const item of listings) {
      const screenshots: GoogleSnapshot["locales"][string]["screenshots"] = [];
      for (const deviceType of Object.keys(googleScreenshotDevices)) {
        const { images } = imageList.parse(
          await request(
            `${url}/listings/${item.language}/${deviceType}`,
            { headers },
            "google_images",
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
    } catch {
      throw new CheckError(
        "google_cleanup",
        `临时 edit ${id} 清理失败，请检查 Google Play 后重试。`,
      );
    }
  }
}
