import { screenshotGroup } from "./screenshot-groups";
import { graphicDimensions } from "./model";
import { maxImagePixels } from "./asset-reference";
import sharp from "sharp";
import type { AssetTarget } from "./asset-target";
import {
  appleScreenDimensions,
  googleScreenshotDevices,
  validGoogleDimensions,
  type DeviceGroup,
} from "./screenshot-groups";

export class ImageSizeError extends Error {}
type Size = [number, number];
// At most 0.5% of either axis may be lost to a centered crop.
const tolerance = 0.005;
function near(w: number, h: number, [tw, th]: Size) {
  return Math.min(w * th, h * tw) >= (1 - tolerance) * Math.max(w * th, h * tw);
}
export function storeDimensions(
  w: number,
  h: number,
  target: AssetTarget,
  catalog?: DeviceGroup[],
): Size {
  let choices: Size[];
  let requirement: string;
  if (target.kind === "graphic") {
    choices = [graphicDimensions[target.type]];
    requirement = choices[0].join(" × ") + " px";
  } else if (target.platform === "google") {
    if (validGoogleDimensions(target.group, w, h)) return [w, h];
    if (!Object.hasOwn(googleScreenshotDevices, target.group))
      throw new ImageSizeError(
        "该历史设备组暂无可验证的截图规格，请选择手机或平板。",
      );
    // Find the largest legal standard size, including images just beyond 2.3:1.
    const short = Math.min(w, h),
      long = Math.max(w, h);
    const maxLong = Math.min(long, 3840, Math.floor((short * 23) / 10));
    const shortSide = Math.min(
      short,
      Math.max(
        Math.ceil((maxLong * 10) / 23),
        Math.round((maxLong * short) / long),
      ),
    );
    const orient = (s: number, l: number): Size => (w < h ? [s, l] : [l, s]);
    choices = [orient(shortSide, maxLong)];
    if (target.group !== "phoneScreenshots") {
      const unit = Math.floor(Math.min(short / 9, long / 16, 7680 / 16));
      choices.push(orient(unit * 9, unit * 16));
    }
    if (target.preferred)
      choices.push(target.preferred.split("x").map(Number) as Size);
    choices = choices.filter(([a, b]) =>
      validGoogleDimensions(target.group, a, b),
    );
    requirement =
      "每边 320–3840 px，长边最多为短边的 2.3 倍" +
      (target.group === "phoneScreenshots"
        ? ""
        : "；大屏也支持每边 1080–7680 px 的 16:9 或 9:16");
  } else {
    const group = screenshotGroup("apple", target.group, catalog);
    choices = appleScreenDimensions(group).map(
      (size) => size.split(" × ").map(Number) as Size,
    );
    if (!choices.length)
      throw new ImageSizeError(
        "无法确认此设备组的官方尺寸，请选择有屏幕规格的设备组。",
      );
    requirement = choices.map((s) => s.join(" × ")).join("、") + " px";
  }
  if (choices.some(([a, b]) => a === w && b === h)) return [w, h];
  const candidates = choices
    .filter((size) => size[0] <= w && size[1] <= h && near(w, h, size))
    .sort((a, b) => b[0] * b[1] - a[0] * a[1]);
  const preferred =
    target.kind === "screenshot" &&
    candidates.find((size) => size.join("x") === target.preferred);
  if (preferred) return preferred;
  if (candidates.length) return candidates[0];
  throw new ImageSizeError(
    `原图 ${w} × ${h} px；要求 ${requirement}。无法在不放大且比例偏差不超过 0.5% 的条件下适配。`,
  );
}

export async function prepareStoreImage(
  bytes: Buffer,
  target: AssetTarget,
  catalog?: DeviceGroup[],
) {
  const image = sharp(bytes, { limitInputPixels: maxImagePixels });
  const meta = await image.metadata();
  if (!["png", "jpeg"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1)
    throw new ImageSizeError("仅支持静态 PNG/JPEG");
  const { width, height } = meta.autoOrient;
  const [w, h] = storeDimensions(width, height, target, catalog);
  if (w === width && h === height && (meta.orientation ?? 1) === 1)
    return bytes;
  return image
    .autoOrient()
    .resize(w, h, {
      fit: "cover",
      position: "centre",
      withoutEnlargement: true,
    })
    .toBuffer();
}
