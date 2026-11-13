import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "./db";
import { assets } from "./schema";
export function assetPath(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid asset id");
  return path.join(
    process.env.STORAGE_PATH ?? path.join(process.cwd(), "data/assets"),
    id,
  );
}
export async function storeAsset(buffer: Buffer) {
  const meta = await sharp(buffer, { limitInputPixels: 40000000 }).metadata();
  if (
    !["png", "jpeg"].includes(meta.format ?? "") ||
    !meta.width ||
    !meta.height ||
    (meta.pages ?? 1) > 1
  )
    throw new Error("仅支持静态 PNG/JPEG");
  const id = createHash("sha256").update(buffer).digest("hex");
  await mkdir(path.dirname(assetPath(id)), { recursive: true, mode: 0o700 });
  const temporary = `${assetPath(id)}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, buffer, { flag: "wx", mode: 0o600 });
    await rename(temporary, assetPath(id));
  } finally {
    await unlink(temporary).catch(() => {});
  }
  const row = {
    id,
    mime: meta.format === "png" ? "image/png" : "image/jpeg",
    width: meta.width,
    height: meta.height,
    bytes: buffer.length,
  };
  await db().insert(assets).values(row).onConflictDoNothing();
  return { ...row, url: `/api/assets/${id}` };
}
export { readFile };
