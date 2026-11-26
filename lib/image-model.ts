import type { ImageReview, Resolution } from "./image-resolution";
import { localeCode } from "./store-locales";
import { assetUrl } from "./asset-reference";
import {
  googleScreenshotDevices,
  screenModelSizes,
  validGoogleDimensions,
} from "./screenshot-groups";
import { z } from "zod";

const genericSizes = ["auto", "1024x1024", "1024x1536", "1536x1024"];
function googleModelSize(device: string, size: string) {
  const match = /^([1-9]\d{2,3})x([1-9]\d{2,3})$/.exec(size);
  return (
    !!match && validGoogleDimensions(device, Number(match[1]), Number(match[2]))
  );
}
export const imageSettings = z
  .object({
    prompt: z.string().trim().min(1, "请填写提示词").max(8000),
    references: z.array(assetUrl).max(4).default([]),
    modelSize: z
      .string()
      .refine(
        (size) =>
          genericSizes.includes(size) ||
          screenModelSizes.has(size) ||
          googleModelSize("tenInchScreenshots", size),
        "不支持的生成尺寸",
      )
      .default("auto"),
    quality: z.enum(["auto", "low", "medium", "high"]).default("auto"),
  })
  .strict();
export type ImageSettings = z.infer<typeof imageSettings>;
export const imageTarget = z.object({
  appId: z.uuid(),
  platform: z.enum(["apple", "google"]),
  locale: localeCode,
});
const deviceGroup = z.string().regex(/^[A-Za-z0-9_-]{1,150}$/);
export const imageHistoryQuery = imageTarget
  .extend({
    deviceGroup: deviceGroup.optional(),
    modelSize: imageSettings.shape.modelSize.removeDefault().optional(),
  })
  .refine(
    (query) => Boolean(query.deviceGroup) === Boolean(query.modelSize),
    "设备分组和分辨率需要一起提供",
  );
export const imageRequest = imageTarget
  .extend({
    deviceGroup: deviceGroup.optional(),
    requestId: z.uuid(),
    previewFirst: z.boolean().optional(),
    settings: imageSettings,
    screenshots: z.array(assetUrl).min(1).max(50).optional(),
  })
  .strict()
  .refine(({ platform, deviceGroup, settings }) => {
    const size = settings.modelSize;
    if (genericSizes.includes(size)) return true;
    if (
      platform === "google" &&
      deviceGroup &&
      Object.hasOwn(googleScreenshotDevices, deviceGroup)
    )
      return googleModelSize(deviceGroup, size);
    return screenModelSizes.has(size);
  }, "当前设备不支持此生成尺寸");
export type ImageRecord = {
  id: string;
  status: string;
  input: {
    locale: string;
    deviceGroup?: string;
    settings: ImageSettings;
    screenshots?: string[];
    screenshotIndex?: number;
  };
  result: {
    review?: ImageReview;
    resolution?: Resolution;
    originalUrl?: string;
    url?: string;
    width?: number;
    height?: number;
    error?: string;
  } | null;
  created_at: string;
};
