import type { AssetTarget } from "./asset-target";

export async function storeImage(
  source: File | string,
  target?: AssetTarget,
): Promise<string> {
  const form = new FormData();
  if (typeof source === "string") form.set("asset", source);
  else form.set("file", source);
  if (target) form.set("target", JSON.stringify(target));
  const response = await fetch("/api/assets", { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "图片处理失败");
  return result.url;
}
