import { access } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { assets } from "./schema";
import { assetPath, storeAsset } from "./storage";
import { downloadImage } from "./image-provider";
export class StoreSyncError extends Error {}
import type { StoreLocales } from "./apple-sync-model";
// API credentials are never attached to CDN requests. Files remain behind the local auth API.
export async function saveStoreScreenshots(
  snapshot: { locales: StoreLocales },
  previous?: { locales: StoreLocales },
  download = downloadImage,
) {
  const cached = new Map<string, string>();
  for (const entry of Object.values(previous?.locales ?? {}))
    for (const image of entry.screenshots ?? [])
      if (image.sourceUrl && image.url) cached.set(image.sourceUrl, image.url);
  let saved = 0;
  for (const entry of Object.values(snapshot.locales))
    for (const image of entry.screenshots) {
      if (!image.sourceUrl) continue;
      try {
        const cachedUrl = cached.get(image.sourceUrl);
        if (cachedUrl) {
          const id = cachedUrl.split("/").at(-1)!;
          const asset = db()
            .select()
            .from(assets)
            .where(eq(assets.id, id))
            .get();
          if (
            asset &&
            (await access(assetPath(id)).then(
              () => true,
              () => false,
            ))
          ) {
            image.width = asset.width;
            image.height = asset.height;
            image.url = cachedUrl;
            saved++;
            continue;
          }
        }
        const bytes = await download(image.sourceUrl);
        if (bytes.length > 20 * 1024 * 1024) throw new Error("Image too large");
        const asset = await storeAsset(bytes);
        image.url = asset.url;
        image.width = asset.width;
        image.height = asset.height;
        cached.set(image.sourceUrl, asset.url);
        saved++;
      } catch {
        throw new StoreSyncError(
          "商店截图下载或保存失败，本次未替换上次资料快照。请检查网络、素材地址与本机存储后重试。",
        );
      }
    }
  return saved;
}
