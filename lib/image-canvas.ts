// GPT Image 2 custom canvases use 16-pixel increments. Request a native
// canvas that can be downsampled to the store asset without visible cropping.
export function modelCanvas(model: string, width: number, height: number) {
  if (/^gpt-image-1(?:$|[.-])/.test(model))
    return width === height
      ? "1024x1024"
      : width > height
        ? "1536x1024"
        : "1024x1536";
  if (!/^gpt-image-2(?:\.\d+)?(?:$|-)/.test(model)) return width + "x" + height;
  const ratio = Math.max(1 / 3, Math.min(3, width / height));
  const candidates: { w: number; h: number }[] = [];
  for (let w = 16; w <= 3840; w += 16) {
    for (const h of [
      Math.floor(w / ratio / 16) * 16,
      Math.ceil(w / ratio / 16) * 16,
    ]) {
      if (
        h < 16 ||
        h > 3840 ||
        w * h < 655360 ||
        w * h > 3840 * 2160 ||
        w > 3 * h ||
        h > 3 * w
      )
        continue;
      if (Math.min(w, h * ratio) < 0.995 * Math.max(w, h * ratio)) continue;
      candidates.push({ w, h });
    }
  }
  const canvas =
    candidates.find(({ w, h }) => w >= width && h >= height) ?? candidates.at(-1);
  if (!canvas) throw new Error("没有符合原图比例的模型画布");
  return canvas.w + "x" + canvas.h;
}
