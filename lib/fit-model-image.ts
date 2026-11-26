import sharp from "sharp";
import { maxImagePixels } from "./asset-reference";

// Nearest-neighbor enlargement repeats source pixels without inventing colors.
export async function fitModelImage(
  bytes: Buffer,
  width: number,
  height: number,
) {
  const image = sharp(bytes, { limitInputPixels: maxImagePixels });
  const size = (await image.metadata()).autoOrient;
  return image
    .autoOrient()
    .resize(width, height, {
      fit: "cover",
      position: "centre",
      kernel:
        size.width < width || size.height < height ? "nearest" : "lanczos3",
    })
    .png()
    .toBuffer();
}
