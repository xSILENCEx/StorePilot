import { z } from "zod";
import sharp from "sharp";
import { authorize, failure, HttpError, json } from "../../../../../lib/http";
import { getGroup, assertGroupApp } from "../../../../../lib/screenshot-store";
import { deviceFor } from "../../../../../lib/screenshot-model";
import { assetPath, readFile, storeAsset } from "../../../../../lib/storage";
import { pool } from "../../../../../lib/db";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await authorize(request);
    const { id } = await context.params;
    z.uuid().parse(id);
    const { url } = z
      .object({ url: z.string().regex(/^\/api\/assets\/[a-f0-9]{64}$/) })
      .parse(await request.json());
    const group = await getGroup(id);
    await assertGroupApp(group);
    const device = deviceFor(group.device);
    const {
      rows: [asset],
    } = await pool().query("select * from assets where id=$1", [
      url.split("/").at(-1),
    ]);
    if (
      !asset ||
      asset.width !== device.width ||
      asset.height !== device.height
    )
      throw new HttpError(
        400,
        `此设备成品截图必须为 ${device.width} × ${device.height} 像素`,
      );
    if (asset.bytes > 8 * 1024 * 1024)
      throw new HttpError(400, "成品截图不能超过 8 MB，请压缩或使用 JPEG");
    const original = await readFile(assetPath(asset.id));
    const meta = await sharp(original).metadata();
    if (meta.hasAlpha)
      throw new HttpError(
        400,
        "成品截图不能包含透明通道，请导出不透明 PNG/JPEG",
      );
    const thumb = await storeAsset(
      await sharp(original)
        .resize({ width: 360 })
        .jpeg({ quality: 78 })
        .toBuffer(),
    );
    const candidateId = crypto.randomUUID();
    await pool().query(
      "insert into image_candidates(id,group_id,status,settings,origin,url,thumbnail) values($1,$2,'succeeded',$3,'upload',$4,$5)",
      [
        candidateId,
        id,
        {
          ...group.settings,
          output: asset.mime === "image/jpeg" ? "jpeg" : "png",
        },
        url,
        thumb.url,
      ],
    );
    return json({ id: candidateId }, 201);
  } catch (e) {
    return failure(e);
  }
}
