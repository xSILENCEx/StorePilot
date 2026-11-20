import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { prepareStoreImage, storeDimensions } from "../lib/prepare-store-image";
import type { AssetTarget } from "../lib/asset-target";
const icon = { kind: "graphic", platform: "google", type: "icon" } as const;
const feature = { ...icon, type: "featureGraphic" } as const;
const phone: AssetTarget = {
  kind: "screenshot",
  platform: "google",
  group: "phoneScreenshots",
  appId: "test",
};
const apple: AssetTarget = {
  ...phone,
  platform: "apple",
  group: "IPHONE_DYNAMIC_ISLAND_MEDIUM_PROFILE",
};
test("图片尺寸按商店用途校验，只缩小，拒绝比例不符或任一方向不足", () => {
  assert.deepEqual(storeDimensions(1024, 1024, icon), [512, 512]);
  assert.deepEqual(storeDimensions(2048, 1004, feature), [1024, 500]);
  assert.throws(() => storeDimensions(2048, 1010, feature));
  assert.throws(() => storeDimensions(1026, 499, feature));
  assert.deepEqual(storeDimensions(2412, 5244, apple), [1206, 2622]);
  assert.deepEqual(storeDimensions(2556, 1179, apple), [2556, 1179]);
  assert.throws(() => storeDimensions(590, 1278, apple));
  assert.deepEqual(storeDimensions(1080, 2400, phone), [1080, 2400]);
  assert.deepEqual(storeDimensions(5400, 9600, phone), [2160, 3840]);
  assert.deepEqual(storeDimensions(1000, 2305, phone), [1000, 2300]);
  assert.throws(() => storeDimensions(1000, 2400, phone));
  assert.throws(() => storeDimensions(319, 640, phone));
  assert.deepEqual(
    storeDimensions(4320, 7680, { ...phone, group: "tenInchScreenshots" }),
    [4320, 7680],
  );
});
test("实际输出尊重 EXIF 方向，准确尺寸的原图保留原始字节", async () => {
  const bytes = await sharp({
    create: { width: 1002, height: 2048, channels: 3, background: "red" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const result = await prepareStoreImage(bytes, feature);
  const meta = await sharp(result).metadata();
  assert.deepEqual([meta.width, meta.height], [1024, 500]);
  assert.strictEqual(await prepareStoreImage(result, feature), result);
});
