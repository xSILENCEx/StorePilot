import { authorize, failure, HttpError, json } from "../../../lib/http";
import { storeAsset } from "../../../lib/storage";
export async function POST(request: Request) {
  try {
    await authorize(request);
    if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024)
      throw new HttpError(413, "素材不能超过 20 MB");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024)
      throw new HttpError(400, "请选择不超过 20 MB 的 PNG/JPEG");
    try {
      return json(await storeAsset(Buffer.from(await file.arrayBuffer())), 201);
    } catch (e) {
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
