import { z } from "zod";
export const assetUrl = z.string().regex(/^\/api\/assets\/[a-f0-9]{64}$/);
export const imageSettings = z
  .object({
    prompt: z.string().trim().min(1, "请填写提示词").max(8000),
    references: z.array(assetUrl).max(4).default([]),
    modelSize: z
      .enum(["auto", "1024x1024", "1024x1536", "1536x1024"])
      .default("auto"),
    quality: z.enum(["auto", "low", "medium", "high"]).default("auto"),
  })
  .strict();
export type ImageSettings = z.infer<typeof imageSettings>;
export const imageTarget = z.object({
  appId: z.uuid(),
  platform: z.enum(["apple", "google"]),
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
});
export const imageRequest = imageTarget
  .extend({ requestId: z.uuid(), settings: imageSettings })
  .strict();
export type ImageRecord = {
  id: string;
  status: string;
  input: { locale: string; settings: ImageSettings };
  result: {
    url?: string;
    width?: number;
    height?: number;
    error?: string;
  } | null;
  created_at: string;
};
