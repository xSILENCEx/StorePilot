import { z } from "zod";
export const maxAssetBytes = 20 * 1024 * 1024;
export const assetIdPattern = /^[a-f0-9]{64}$/;
const prefix = "/api/assets/";
export const assetUrl = z
  .string()
  .refine(
    (value) =>
      value.startsWith(prefix) &&
      assetIdPattern.test(value.slice(prefix.length)),
    "无效的素材地址",
  );
export function assetIdFromUrl(url: string) {
  return assetUrl.parse(url).slice(prefix.length);
}
export function assetUrlFromId(id: string) {
  return prefix + id;
}

export const maxImagePixels = 40_000_000;
