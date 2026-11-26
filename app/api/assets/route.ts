import {
  assetIdFromUrl,
  assetUrl,
  maxAssetBytes,
} from "../../../lib/asset-reference";
import { authorize, failure, HttpError, json } from "../../../lib/http";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db";
import { storeSnapshots } from "../../../lib/schema";
import { assetTarget } from "../../../lib/asset-target";
import {
  prepareStoreImage,
  ImageSizeError,
} from "../../../lib/prepare-store-image";
import { assetPath, readFile, storeAsset } from "../../../lib/storage";
export async function POST(request: Request) {
  try {
    await authorize(request);
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024)
      throw new HttpError(413, "素材不能超过 20 MB");
    const form = await request.formData();
    const file = form.get("file");
    const rawTarget = form.get("target");
    const target =
      rawTarget === null
        ? undefined
        : assetTarget.parse(JSON.parse(String(rawTarget)));
    const existing = form.get("asset");
    let bytes: Buffer;
    if (file instanceof File && !existing) {
      if (!file.size || file.size > maxAssetBytes)
        throw new HttpError(400, "请选择不超过 20 MB 的 PNG/JPEG");
      bytes = Buffer.from(await file.arrayBuffer());
    } else if (
      !file &&
      target &&
      typeof existing === "string" &&
      assetUrl.safeParse(existing).success
    ) {
      bytes = await readFile(assetPath(assetIdFromUrl(existing))).catch(() => {
        throw new HttpError(404, "素材文件不存在");
      });
    } else throw new HttpError(400, "请选择图片");
    try {
      if (target) {
        const catalog =
          target.kind === "screenshot" && target.platform === "apple"
            ? db()
                .select()
                .from(storeSnapshots)
                .where(eq(storeSnapshots.app_id, target.appId))
                .get()?.current_snapshot.deviceGroups
            : undefined;
        bytes = await prepareStoreImage(bytes, target, catalog);
      }
      return json(await storeAsset(bytes), 201);
    } catch (e) {
      if (e instanceof ImageSizeError) throw new HttpError(400, e.message);
      if (
        e instanceof Error &&
        /Input|pixel|PNG|JPEG|image|unsupported/i.test(e.message)
      )
        throw new HttpError(
          400,
          "无效图片：仅支持静态 PNG/JPEG，最多 4000 万像素",
        );
      throw e;
    }
  } catch (e) {
    return failure(e);
  }
}
