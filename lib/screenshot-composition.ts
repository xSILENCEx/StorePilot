import sharp, { type OverlayOptions } from "sharp";
import { maxImagePixels } from "./asset-reference";
import { existsSync } from "node:fs";
import type { ScreenshotPlan } from "./screenshot-plan";

export async function composeScreenshot(
  background: Buffer,
  legacyScreen: Buffer | null,
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
  const layers: OverlayOptions[] = [];
  // Older checkpoints contain only a background, so restore their app screen.
  if (legacyScreen) {
    const shot = await sharp(legacyScreen, { limitInputPixels: maxImagePixels })
      .autoOrient()
      .resize(maxW, maxH, { fit: "inside" })
      .png()
      .toBuffer({ resolveWithObject: true });
    layers.push({
      input: shot.data,
      left: Math.floor((width - shot.info.width) / 2),
      top: top + Math.floor((maxH - shot.info.height) / 2),
    });
  }
  if (title) {
    const titleTop =
      plan.headlinePosition === "bottom"
        ? height - header
        : plan.headlinePosition === "middle"
          ? Math.floor((height - header) / 2)
          : 0;
    const zone = await sharp(background)
      .extract({ left: 0, top: titleTop, width, height: header })
      .resize(1, 1)
      .removeAlpha()
      .raw()
      .toBuffer();
    const light = 0.299 * zone[0] + 0.587 * zone[1] + 0.114 * zone[2] > 150;
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
        align: plan.headlineAlign === "center" ? "centre" : plan.headlineAlign,
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
      left:
        plan.headlineAlign === "left"
          ? pad
          : plan.headlineAlign === "right"
            ? width - pad - line.info.width
            : Math.floor((width - line.info.width) / 2),
      top: titleTop + Math.floor((header - line.info.height) / 2),
    });
  }
  if (!layers.length) return background;
  return sharp(background).composite(layers).png().toBuffer();
}
