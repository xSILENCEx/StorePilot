import { z } from "zod";
export const platformSchema = z.enum(["apple", "google"]);
export type Platform = z.infer<typeof platformSchema>;
const assetUrl = z.string().regex(/^\/api\/assets\/[a-f0-9]{64}$/);
export const graphicLabels = {
  icon: "应用图标",
  featureGraphic: "宣传图",
  tvBanner: "Android TV 横幅",
} as const;
export const graphicTypes = ["icon", "featureGraphic", "tvBanner"] as const;
export type GraphicType = (typeof graphicTypes)[number];
export const draftSchema = z.object({
  title: z.string().max(1000),
  subtitle: z.string().max(1000),
  description: z.string().max(20000),
  keywords: z.string().max(2000),
  video: z.string().max(2000).optional(),
  promotionalText: z.string().max(10000).optional(),
  whatsNew: z.string().max(20000).optional(),
  supportUrl: z.string().max(2000).optional(),
  marketingUrl: z.string().max(2000).optional(),
  privacyPolicyUrl: z.string().max(2000).optional(),
  privacyChoicesUrl: z.string().max(2000).optional(),
  images: z.array(assetUrl).max(50),
  graphics: z.partialRecord(z.enum(graphicTypes), assetUrl).optional(),
  screenshotGroups: z
    .record(
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,150}$/)
        .refine(
          (k) =>
            !["ungrouped", "constructor", "prototype", "__proto__"].includes(k),
        ),
      z.array(assetUrl).max(10),
    )
    .optional(),
});
export type Draft = z.infer<typeof draftSchema>;
export const appSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    apple: z.string().max(255),
    google: z.string().max(255),
    drafts: z.record(
      z.string().regex(/^(apple|google):[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
      draftSchema,
    ),
  })
  .refine(
    (a) =>
      Object.entries(a.drafts).every(
        ([key, d]) =>
          !key.startsWith("google:") ||
          Object.values(d.screenshotGroups ?? {}).every(
            (images) => images.length <= 8,
          ),
      ),
    "Google Play 每个设备组最多 8 张截图",
  )
  .refine((a) => a.apple.trim() || a.google.trim(), "至少启用一个平台");
export type StoreApp = z.infer<typeof appSchema> & {
  readonly platformIcons?: Partial<Record<Platform, string>>;
};
export const workspaceSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    apps: z.array(appSchema).max(100),
  })
  .refine(
    (v) => new Set(v.apps.map((a) => a.id)).size === v.apps.length,
    "应用 ID 重复",
  );
export function validateDraft(platform: Platform, draft: Draft) {
  const limits =
    platform === "apple"
      ? { title: 30, subtitle: 30, description: 4000, keywords: 100 }
      : { title: 30, subtitle: 80, description: 4000 };
  return Object.entries(limits).flatMap(([field, limit]) => {
    const text =
      draft[
        field as keyof Omit<Draft, "images" | "screenshotGroups" | "graphics">
      ] ?? "";
    const length =
      platform === "apple" && field === "keywords"
        ? new TextEncoder().encode(text).length
        : Array.from(text).length;
    return length > limit
      ? [`${field} 超过 ${limit}${field === "keywords" ? " 字节" : " 字符"}`]
      : [];
  });
}
