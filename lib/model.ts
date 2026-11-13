import { z } from "zod";
export const platformSchema = z.enum(["apple", "google"]);
export type Platform = z.infer<typeof platformSchema>;
export const draftSchema = z.object({
  title: z.string().max(1000),
  subtitle: z.string().max(1000),
  description: z.string().max(20000),
  keywords: z.string().max(2000),
  promotionalText: z.string().max(10000).optional(),
  whatsNew: z.string().max(20000).optional(),
  supportUrl: z.string().max(2000).optional(),
  marketingUrl: z.string().max(2000).optional(),
  privacyPolicyUrl: z.string().max(2000).optional(),
  privacyChoicesUrl: z.string().max(2000).optional(),
  images: z.array(z.string().regex(/^\/api\/assets\/[a-f0-9]{64}$/)).max(50),
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
  .refine((a) => a.apple.trim() || a.google.trim(), "至少启用一个平台");
export type StoreApp = z.infer<typeof appSchema>;
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
    const text = draft[field as keyof Omit<Draft, "images">] ?? "";
    const length =
      platform === "apple" && field === "keywords"
        ? new TextEncoder().encode(text).length
        : Array.from(text).length;
    return length > limit
      ? [`${field} 超过 ${limit}${field === "keywords" ? " 字节" : " 字符"}`]
      : [];
  });
}
