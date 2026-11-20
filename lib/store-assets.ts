import { access } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { assets } from "./schema";
import { assetPath, storeAsset } from "./storage";
import { downloadImage } from "./image-provider";
export class StoreSyncError extends Error {}
import type { StoreLocales, AppleScreenshot } from "./apple-sync-model";
type ImageSnapshot = { locales: StoreLocales; icon?: AppleScreenshot };
function snapshotImages(snapshot: ImageSnapshot) {
  const images = Object.values(snapshot.locales).flatMap((entry) => [
    ...entry.screenshots,
    ...Object.values(entry.graphics ?? {}),
  ]);
  if (snapshot.icon) images.push(snapshot.icon);
  return new Set(images);
}
// API credentials are never attached to CDN requests. Files remain behind the local auth API.
export async function saveStoreImages(
  snapshot: ImageSnapshot,
  previous?: ImageSnapshot,
  download = downloadImage,
) {
  const cached = new Map<string, string>();
  if (previous)
    for (const image of snapshotImages(previous))
      if (image.sourceUrl && image.url) cached.set(image.sourceUrl, image.url);
  for (const image of snapshotImages(snapshot)) {
    if (!image.sourceUrl) continue;
    try {
      const cachedUrl = cached.get(image.sourceUrl);
      if (cachedUrl) {
        const id = cachedUrl.split("/").at(-1)!;
        const asset = db().select().from(assets).where(eq(assets.id, id)).get();
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
    } catch {
      throw new StoreSyncError(
        "商店图片下载或保存失败，本次未替换上次资料快照。请检查网络、素材地址与本机存储后重试。",
      );
    }
  }
  return Object.values(snapshot.locales).reduce(
    (count, entry) =>
      count + entry.screenshots.filter((image) => image.url).length,
    0,
  );
}
