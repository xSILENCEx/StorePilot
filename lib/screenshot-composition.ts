import sharp, { type OverlayOptions } from "sharp";
import { maxImagePixels } from "./asset-reference";
import { existsSync } from "node:fs";
import type { ScreenshotPlan } from "./screenshot-plan";

export async function composeScreenshot(
  background: Buffer,
  screen: Buffer,
  width: number,
  height: number,
  plan: ScreenshotPlan,
  index: number,
  locale: string,
) {
  const portrait = height >= width;
  const title = plan.titles[index];
  const pad = Math.max(1, Math.round(Math.min(width, height) * 0.055));
  const header = Math.max(1, Math.round(height * (portrait ? 0.19 : 0.24)));
  const top = title ? header + pad : pad;
  const maxW = Math.max(1, width - 2 * pad),
    maxH = Math.max(1, height - top - pad);
  const shot = await sharp(screen, { limitInputPixels: maxImagePixels })
    .autoOrient()
    .resize(maxW, maxH, { fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const layers: OverlayOptions[] = [
    {
      input: shot.data,
      left: Math.floor((width - shot.info.width) / 2),
      top: top + Math.floor((maxH - shot.info.height) / 2),
    },
  ];
  if (title) {
    const hex = plan.palette.slice(1);
    const light =
      0.299 * parseInt(hex.slice(0, 2), 16) +
        0.587 * parseInt(hex.slice(2, 4), 16) +
        0.114 * parseInt(hex.slice(4), 16) >
      150;
    layers.push({
      input: {
        create: {
          width,
          height: header,
          channels: 4,
          background: plan.palette,
        },
      },
      left: 0,
      top: 0,
    });
    const escaped = title
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    const fonts: Record<string, [string, string]> = {
      ko: ["Apple SD Gothic Neo", "AppleSDGothicNeo.ttc"],
      zh: ["Hiragino Sans GB", "Hiragino Sans GB.ttc"],
    };
    const preferred = fonts[locale.split("-")[0]];
    const fontfile = preferred && "/System/Library/Fonts/" + preferred[1];
    const installed = fontfile && existsSync(fontfile);
    const glyphs = await sharp({
      text: {
        text:
          '<span foreground="' +
          (light ? "#101010" : "#ffffff") +
          '">' +
          escaped +
          "</span>",
        font:
          (installed ? preferred[0] : "sans-serif") +
          " bold " +
          Math.max(1, Math.round(Math.min(width, height) * 0.065)),
        ...(installed ? { fontfile } : {}),
        width: maxW,
        align: "centre",
        wrap: "word-char",
        rgba: true,
      },
    })
      .png()
      .toBuffer();
    const line = await sharp(glyphs)
      .resize(maxW, Math.max(1, Math.round(header * 0.8)), {
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    layers.push({
      input: line.data,
      left: Math.floor((width - line.info.width) / 2),
      top: Math.floor((header - line.info.height) / 2),
    });
  }
  return sharp(background).composite(layers).png().toBuffer();
}
