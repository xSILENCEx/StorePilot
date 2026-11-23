import { z } from "zod";
export const platformSchema = z.enum(["apple", "google"]);
export type Platform = z.infer<typeof platformSchema>;
const assetUrl = z.string().regex(/^\/api\/assets\/[a-f0-9]{64}$/);
export const graphicLabels = {
  icon: "应用图标",
  featureGraphic: "宣传图",
} as const;
export const graphicTypes = ["icon", "featureGraphic"] as const;
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
  // Older drafts may still reference a TV banner. Keep them editable.
  graphics: z
    .partialRecord(z.enum([...graphicTypes, "tvBanner"]), assetUrl)
    .optional(),
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
// App Store Connect app/platform-version information and Play Console listing limits.
export function storeTextLimits(platform: Platform): Record<string, number> {
  return platform === "apple"
    ? {
        title: 30,
        subtitle: 30,
        description: 4000,
        keywords: 100,
        promotionalText: 170,
        whatsNew: 4000,
      }
    : { title: 30, subtitle: 80, description: 4000 };
}
export function fieldLengthIssue(
  platform: Platform,
  field: string,
  text: string,
) {
  if (!text) return;
  const limit = storeTextLimits(platform)[field];
  if (limit === undefined) return;
  const bytes = platform === "apple" && field === "keywords";
  const length = bytes
    ? new TextEncoder().encode(text).length
    : Array.from(text).length;
  if (length > limit)
    return field + " 超过 " + limit + (bytes ? " 字节" : " 字符");
  if (platform === "apple" && field === "title" && length < 2)
    return "title 至少需要 2 字符";
  if (
    bytes &&
    text.split(/[,，、]/u).some((term) => Array.from(term.trim()).length < 3)
  )
    return "keywords 每个关键词至少需要 3 字符";
}
export function validateDraft(platform: Platform, draft: Draft) {
  return Object.keys(storeTextLimits(platform)).flatMap((field) => {
    const issue = fieldLengthIssue(
      platform,
      field,
      String(draft[field as keyof Draft] ?? ""),
    );
    return issue ? [issue] : [];
  });
}
