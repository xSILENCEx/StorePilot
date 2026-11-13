import { z } from "zod";
export const devices = [
  {
    id: "apple-iphone-large",
    platform: "apple",
    name: "iPhone 大屏",
    width: 1320,
    height: 2868,
    max: 10,
  },
  {
    id: "apple-iphone-65",
    platform: "apple",
    name: "iPhone 6.5 英寸",
    width: 1242,
    height: 2688,
    max: 10,
  },
  {
    id: "apple-ipad-13",
    platform: "apple",
    name: "iPad 13 英寸",
    width: 2064,
    height: 2752,
    max: 10,
  },
  {
    id: "apple-mac",
    platform: "apple",
    name: "Mac",
    width: 2560,
    height: 1600,
    max: 10,
  },
  {
    id: "apple-tv",
    platform: "apple",
    name: "Apple TV",
    width: 1920,
    height: 1080,
    max: 10,
  },
  {
    id: "google-phone",
    platform: "google",
    name: "Android 手机",
    width: 1080,
    height: 1920,
    max: 8,
  },
  {
    id: "google-tablet-7",
    platform: "google",
    name: "Android 7 英寸平板",
    width: 1200,
    height: 1920,
    max: 8,
  },
  {
    id: "google-tablet-10",
    platform: "google",
    name: "Android 10 英寸平板",
    width: 1600,
    height: 2560,
    max: 8,
  },
  {
    id: "google-tv",
    platform: "google",
    name: "Android TV",
    width: 1920,
    height: 1080,
    max: 8,
  },
] as const;
export type Device = (typeof devices)[number];
export const assetUrl = z.string().regex(/^\/api\/assets\/[a-f0-9]{64}$/);
export const screenshotSettings = z.object({
  mode: z.enum(["template-ai", "image-ai", "template"]).default("template-ai"),
  headline: z.string().max(100).default(""),
  subtitle: z.string().max(240).default(""),
  prompt: z.string().max(8000).default(""),
  template: z.enum(["hero", "split"]).default("hero"),
  background: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#e8f3ef"),
  foreground: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#123b32"),
  screenshot: assetUrl.nullable().default(null),
  art: assetUrl.nullable().default(null),
  modelSize: z
    .enum(["auto", "1024x1024", "1024x1536", "1536x1024"])
    .default("1024x1536"),
  quality: z.enum(["auto", "low", "medium", "high"]).default("auto"),
  output: z.enum(["png", "jpeg"]).default("png"),
  imageFit: z.enum(["contain", "cover"]).default("contain"),
});
export type ScreenshotSettings = z.infer<typeof screenshotSettings>;
export const groupTarget = z.object({
  appId: z.uuid(),
  platform: z.enum(["apple", "google"]),
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
  device: z.enum(devices.map((d) => d.id)),
});
export type AdoptedImage = {
  candidateId: string;
  url: string;
  thumbnail: string;
  width: number;
  height: number;
  format: "png" | "jpeg";
  origin: "template" | "template-ai" | "image-ai" | "upload";
};
export type ImageCandidate = {
  id: string;
  job_id: string | null;
  status: string;
  url: string | null;
  thumbnail: string | null;
  error: string | null;
  settings: ScreenshotSettings;
  origin: string;
  created_at: string;
  has_raw: boolean;
  discarded: boolean;
};
export type ScreenshotGroup = {
  id: string;
  app_id: string;
  platform: "apple" | "google";
  locale: string;
  device: string;
  revision: number;
  settings: ScreenshotSettings;
  adopted: AdoptedImage[];
  previous: AdoptedImage[];
  has_previous: boolean;
  candidates: ImageCandidate[];
};
export function deviceFor(id: string, platform?: string): Device {
  const found = devices.find(
    (d) => d.id === id && (!platform || d.platform === platform),
  );
  if (!found) throw new Error("设备类别与平台不匹配");
  return found;
}
export function validateGeneration(settings: ScreenshotSettings) {
  if (settings.mode !== "image-ai" && !settings.screenshot)
    return "模板生成需要选择真实 App 截图";
  if (settings.mode !== "template" && !settings.prompt.trim())
    return "请填写生成提示词";
  return null;
}
export function generationPrompt(settings: ScreenshotSettings, locale: string) {
  if (settings.mode === "template-ai")
    return `Create only a polished background illustration for an app store screenshot, suitable for locale ${locale}. No text, no letters, no logos, no UI, no device frame. Keep the central and upper areas clean for a real app screenshot and editable typography, added separately by a deterministic renderer. Art direction: ${settings.prompt}`;
  return `Create an app store promotional screenshot in locale ${locale}. Headline (render exactly): ${settings.headline}. Supporting text: ${settings.subtitle}. If an app screenshot is provided, preserve its real UI and functionality; do not invent product features. User art direction: ${settings.prompt}`;
}
