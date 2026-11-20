import { z } from "zod";
export const configScope = z.enum(["apple", "google", "text", "image"]);
export type ConfigScope = z.infer<typeof configScope>;
const endpoint = z
  .url()
  .max(2000)
  .refine((value) => {
    const u = new URL(value);
    return (
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
    );
  }, "使用 HTTPS 地址；回环地址可使用 HTTP，不要在 URL 中包含密钥、查询参数或片段");
export const configFields = {
  apple: z
    .object({
      issuerId: z
        .string()
        .trim()
        .regex(
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
          "Issuer ID 格式无效",
        ),
      keyId: z
        .string()
        .trim()
        .regex(/^[A-Z0-9]{10}$/, "Key ID 应为 10 位大写字母或数字"),
      appId: z
        .string()
        .trim()
        .regex(/^\d+$/, "填写 App Store Connect 中的数字应用 ID"),
      bundleId: z.string().trim().min(1).max(255),
      appPlatform: z.enum(["IOS", "MAC_OS", "TV_OS", "VISION_OS"]),
      version: z.string().trim().max(100).default(""),
    })
    .strict(),
  google: z
    .object({
      packageName: z
        .string()
        .trim()
        .regex(
          /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/,
          "包名格式无效",
        ),
    })
    .strict(),
  text: z
    .object({
      baseUrl: endpoint,
      model: z.string().trim().min(1).max(200),
      timeoutSeconds: z.number().int().min(10).max(600),
    })
    .strict(),
  image: z
    .object({
      baseUrl: endpoint,
      model: z.string().trim().min(1).max(200),
      timeoutSeconds: z.number().int().min(10).max(600),
    })
    .strict(),
};
export const configInput = z
  .object({
    revision: z.number().int().nonnegative(),
    fields: z.record(z.string(), z.unknown()),
    secret: z.string().max(65536).optional(),
  })
  .strict();
