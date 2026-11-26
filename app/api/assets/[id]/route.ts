import { assetIdPattern } from "../../../../lib/asset-reference";
import { eq } from "drizzle-orm";
import { db } from "../../../../lib/db";
import { assets } from "../../../../lib/schema";
import { assetPath, readFile } from "../../../../lib/storage";
import {
  authorize,
  failure,
  HttpError,
  privateHeaders,
} from "../../../../lib/http";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await authorize(request);
    const { id } = await context.params;
    if (!assetIdPattern.test(id)) throw new HttpError(404, "素材不存在");
    const [asset] = await db().select().from(assets).where(eq(assets.id, id));
    if (!asset) throw new HttpError(404, "素材不存在");
    return new Response(new Uint8Array(await readFile(assetPath(id))), {
      headers: {
        ...privateHeaders,
        "Content-Type": asset.mime,
        "Content-Disposition": "inline",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
