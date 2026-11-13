import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { ScreenshotTemplate } from "../components/screenshot-template";
import { assetPath } from "./storage";
import type { Device, ScreenshotSettings } from "./screenshot-model";
export class TemplateRenderError extends Error {}
export async function dataImage(url: string | null) {
  if (!url) return null;
  const buffer = await readFile(assetPath(url.split("/").at(-1)!));
  const meta = await sharp(buffer).metadata();
  return `data:image/${meta.format === "jpeg" ? "jpeg" : "png"};base64,${buffer.toString("base64")}`;
}
export async function normalizeImage(buffer: Buffer) {
  const image = sharp(buffer, { limitInputPixels: 40000000 });
  const meta = await image.metadata();
  if (
    !["png", "jpeg", "webp"].includes(meta.format ?? "") ||
    (meta.pages ?? 1) > 1
  )
    throw new Error("模型仅可返回静态 PNG / JPEG / WebP 图片");
  return image.rotate().toColourspace("srgb").png().toBuffer();
}
export async function renderScreenshot(
  settings: ScreenshotSettings,
  device: Device,
  background: string | null,
) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: 1,
      javaScriptEnabled: false,
    });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    const html = renderToStaticMarkup(
      <ScreenshotTemplate
        settings={settings}
        width={device.width}
        height={device.height}
        screenshot={await dataImage(settings.screenshot)}
        background={await dataImage(background)}
      />,
    );
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><style>*{box-sizing:border-box}body{margin:0}h1,p{margin:0}</style></head><body>${html}</body></html>`,
      { waitUntil: "load", timeout: 30000 },
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map((image) => image.decode()),
      );
    });
    const overflow = await page
      .locator("[data-template-copy]")
      .evaluate(
        (el) =>
          el.scrollHeight > el.clientHeight + 1 ||
          el.scrollWidth > el.clientWidth + 1,
      );
    if (overflow)
      throw new TemplateRenderError(
        "模板文案超出可用区域，请缩短标题 / 副文案或改用另一模板后重新渲染。",
      );
    return await page.screenshot({
      type: "png",
      animations: "disabled",
      timeout: 30000,
    });
  } finally {
    await browser.close();
  }
}
export async function finishScreenshot(
  buffer: Buffer,
  settings: ScreenshotSettings,
  device: Device,
) {
  const image = sharp(buffer, { limitInputPixels: 40000000 })
    .rotate()
    .resize(device.width, device.height, {
      fit: settings.imageFit,
      background: settings.background,
    })
    .flatten({ background: settings.background })
    .toColourspace("srgb");
  const result = await (
    settings.output === "png"
      ? image.png({ compressionLevel: 9 })
      : image.jpeg({ quality: 94, mozjpeg: true })
  ).toBuffer();
  if (result.length > 8 * 1024 * 1024)
    throw new TemplateRenderError(
      "最终图片超过 8 MB，请切换 JPEG 后重新渲染。",
    );
  const meta = await sharp(result).metadata();
  if (
    meta.width !== device.width ||
    meta.height !== device.height ||
    meta.hasAlpha ||
    !["png", "jpeg"].includes(meta.format ?? "")
  )
    throw new Error("输出图片尺寸或格式复检失败");
  return result;
}
