import sharp from "sharp";
import { ImageSizeError } from "./prepare-store-image";

// Work in display orientation. Nearest-neighbour enlargement preserves pixel
// values; edge replication fills any unused canvas without cropping content.
export async function enlargeTranslation(
  bytes: Buffer,
  width: number,
  height: number,
) {
  const image = sharp(bytes, { limitInputPixels: 40000000 });
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
  return image
    .autoOrient()
    .resize(w, h, { fit: "fill", kernel: "nearest" })
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
