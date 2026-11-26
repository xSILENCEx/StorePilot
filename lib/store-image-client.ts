import { readApiResponse } from "./api-response";
import { maxAssetBytes } from "./asset-reference";
import type { AssetTarget } from "./asset-target";

export async function storeImage(
  source: File | string,
  target?: AssetTarget,
): Promise<string> {
  if (typeof source !== "string" && source.size > maxAssetBytes)
    throw new Error("图片超过 20 MB");
  const form = new FormData();
  if (typeof source === "string") form.set("asset", source);
  else form.set("file", source);
  if (target) form.set("target", JSON.stringify(target));
  const response = await fetch("/api/assets", { method: "POST", body: form });
  const result = await readApiResponse(response, "图片处理失败");
  return result.url;
}

export async function* uploadImages(files: File[], target?: AssetTarget) {
  for (const file of files) {
    try {
      yield await storeImage(file, target);
    } catch (error) {
      throw new Error(
        file.name +
          "：" +
          (error instanceof Error ? error.message : "上传失败"),
      );
    }
  }
}
export function appendImages(current: string[], added: string[]) {
  return [...new Set([...current, ...added])];
}
