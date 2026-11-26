import { maxImagePixels } from "./asset-reference";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { ImageSizeError } from "./prepare-store-image";

const run = promisify(execFile);
async function enhance2x(image: Sharp, w: number, h: number) {
  if (w * h * 4 > maxImagePixels)
    throw new ImageSizeError("2 倍超分辨率输出超过 4000 万像素限制");
  const tool = path.resolve(
    /* turbopackIgnore: true */ process.env.STOREPILOT_WAIFU2X_DIR ??
      "data/tools/waifu2x-ncnn-vulkan-20250915-macos",
  );
  const dir = await mkdtemp(path.join(tmpdir(), "storepilot-waifu2x-"));
  const input = path.join(dir, "input.png"),
    output = path.join(dir, "output.png");
  try {
    await writeFile(input, await image.autoOrient().png().toBuffer());
    await run(
      path.join(tool, "waifu2x-ncnn-vulkan"),
      [
        "-i",
        input,
        "-o",
        output,
        "-m",
        "models-cunet",
        "-n",
        "-1",
        "-s",
        "2",
        "-t",
        "128",
      ],
      { cwd: tool, timeout: 180000, killSignal: "SIGKILL" },
    );
    const result = sharp(output, { limitInputPixels: maxImagePixels });
    const meta = await result.metadata();
    if (meta.width !== w * 2 || meta.height !== h * 2)
      throw new Error("unexpected size");
    return await result.png().toBuffer();
  } catch {
    throw new ImageSizeError(
      "waifu2x 超分辨率处理失败，请检查打包机的工具、模型目录及运行资源",
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

export async function enlargeTranslation(
  bytes: Buffer,
  width: number,
  height: number,
  enhance = false,
) {
  const image = sharp(bytes, { limitInputPixels: maxImagePixels });
  const size = (await image.metadata()).autoOrient;
  const scale = Math.min(width / size.width, height / size.height);
  if (scale < 1)
    throw new ImageSizeError(
      `模型输出 ${size.width}×${size.height} 无法在保留全部像素的情况下放入 ${width}×${height}`,
    );
  const w = Math.round(size.width * scale),
    h = Math.round(size.height * scale);
  const left = Math.floor((width - w) / 2),
    top = Math.floor((height - h) / 2);
  const enhanced = enhance && scale > 1;
  const resized = enhanced
    ? sharp(await enhance2x(image, size.width, size.height))
    : image.autoOrient();
  return resized
    .resize(w, h, { fit: "fill", kernel: enhanced ? "lanczos3" : "nearest" })
    .extend({
      left,
      top,
      right: width - w - left,
      bottom: height - h - top,
      extendWith: "copy",
    })
    .png()
    .toBuffer();
}
