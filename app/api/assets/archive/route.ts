import { findWorkspaceApp } from "../../../../lib/workspace-store";
import { localeCode } from "../../../../lib/store-locales";
import { assetUrl, assetIdFromUrl } from "../../../../lib/asset-reference";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { inArray } from "drizzle-orm";
import { ZipFile } from "yazl";
import { z } from "zod";
import { db } from "../../../../lib/db";
import {
  authorize,
  failure,
  HttpError,
  privateHeaders,
} from "../../../../lib/http";
import { platformSchema } from "../../../../lib/model";
import { assets } from "../../../../lib/schema";
import { assetPath } from "../../../../lib/storage";

const input = z.object({
  appId: z.uuid(),
  platform: platformSchema,
  locale: localeCode,
  group: z.string().trim().min(1).max(160),
  items: z
    .array(
      z.object({
        url: assetUrl,
        label: z.string().max(160).optional(),
      }),
    )
    .min(1)
    .max(1000),
});
function segment(value: string) {
  return (
    Array.from(
      value
        .normalize("NFC")
        .replace(/[<>:"/\\|?*\p{Cc}\p{Cf}]/gu, "-")
        .replace(/\s+/g, " ")
        .trim(),
    )
      .slice(0, 28)
      .join("")
      .replace(/[. ]+$/, "") || "图片"
  );
}
export async function POST(request: Request) {
  try {
    await authorize(request);
    const { appId, platform, locale, group, items } = input.parse(
      await request.json(),
    );
    const app = findWorkspaceApp(appId);
    if (!app?.[platform]) throw new HttpError(404, "应用或平台不存在");
    const ids = items.map((item) => assetIdFromUrl(item.url));
    const rows = db()
      .select()
      .from(assets)
      .where(inArray(assets.id, [...new Set(ids)]))
      .all();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const files = items.map((item, i) => {
      const row = byId.get(ids[i]);
      if (!row)
        throw new HttpError(404, `第 ${i + 1} 张图片不存在，请刷新后重试`);
      const dimensions = row.width + "x" + row.height;
      const extension = row.mime === "image/jpeg" ? "jpg" : "png";
      const index = String(i + 1).padStart(
        Math.max(2, String(items.length).length),
        "0",
      );
      return {
        path: assetPath(row.id),
        dimensions,
        name: `${index}_${segment(item.label || group)}_${dimensions}.${extension}`,
      };
    });
    // Fail before sending download headers if any source file has disappeared.
    for (const file of files)
      if (!(await stat(file.path).catch(() => null))?.isFile())
        throw new HttpError(404, `缺少 ${file.name}，请重新同步或上传`);
    const dimensions = new Set(files.map((file) => file.dimensions));
    const folder = [
      platform === "apple" ? "AppStore" : "GooglePlay",
      locale,
      dimensions.size === 1 ? files[0].dimensions : "多种分辨率",
    ].join("_");
    const filename =
      [segment(app.name), folder, segment(group)].join("_") + ".zip";
    const zip = new ZipFile();
    const stream = zip.outputStream as Readable;
    zip.on("error", (error) => stream.destroy(error));
    for (const file of files)
      zip.addFile(file.path, folder + "/" + file.name, { compress: false });
    zip.end();
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="images.zip"; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, "%27")}`,
      },
    });
  } catch (e) {
    return failure(e);
  }
}
