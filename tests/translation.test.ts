import { blankDraft } from "../lib/model";
import test from "node:test";
import assert from "node:assert/strict";
import { translationItems, applyTranslation } from "../lib/translation";
import type { Draft } from "../lib/model";

test("逐张选择截图保留目标草稿其余位置，兼容历史未分组截图", () => {
  const source: Draft = {
    ...blankDraft(),
    images: ["old"],
    screenshotGroups: {
      phoneScreenshots: ["a", "b", "c"],
      sevenInchScreenshots: ["t"],
    },
  };
  const target: Draft = {
    ...blankDraft(),
    images: ["existing"],
    screenshotGroups: {
      phoneScreenshots: ["A", "B"],
      sevenInchScreenshots: ["T"],
    },
  };
  const selected = translationItems("google", source).filter((i) =>
    ["phoneScreenshots:1", "phoneScreenshots:2", "ungrouped:0"].includes(i.id),
  );
  const result = applyTranslation(target, selected, {
    "phoneScreenshots:1": "translated B",
    "phoneScreenshots:2": "translated C",
    "ungrouped:0": "translated old",
  });
  assert.deepEqual(result.screenshotGroups, {
    phoneScreenshots: ["A", "translated B", "translated C"],
    sevenInchScreenshots: ["T"],
  });
  assert.deepEqual(result.images, ["translated old"]);
  assert.deepEqual(target.images, ["existing"]);
});
test("根据平台提供对应的文案、网址和图片资源", () => {
  const source: Draft = {
    ...blankDraft(),
    keywords: "keys",
    whatsNew: "Changes",
    supportUrl: "https://example.com",
    video: "https://example.com/video",
    graphics: { icon: "icon", featureGraphic: "feature", tvBanner: "old" },
  };
  assert.deepEqual(
    translationItems("apple", source).map((i) => [i.id, i.kind]),
    [
      ["keywords", "text"],
      ["whatsNew", "text"],
      ["supportUrl", "link"],
    ],
  );
  assert.deepEqual(
    translationItems("google", source).map((i) => [i.id, i.kind]),
    [
      ["keywords", "text"],
      ["video", "link"],
      ["graphic:icon", "graphic"],
      ["graphic:featureGraphic", "graphic"],
    ],
  );
});

import { parseTranslationReply } from "../lib/translation-reply";
test("兼容分段、字段包装及关键词数组，缺失字段和截断仍报错", () => {
  const message = {
    content: [
      {
        type: "text",
        text: '译文：{"fields":{"title":"App","keywords":["a","b"]},"target":"de"}',
      },
    ],
  };
  assert.deepEqual(
    parseTranslationReply({ choices: [{ message }] }, ["title", "keywords"]),
    { title: "App", keywords: "a,b" },
  );
  assert.throws(
    () =>
      parseTranslationReply({ choices: [{ message }] }, [
        "title",
        "description",
      ]),
    /description/,
  );
  assert.throws(
    () =>
      parseTranslationReply(
        { choices: [{ message, finish_reason: "length" }] },
        ["title"],
      ),
    /截断/,
  );
});

import { modelCanvas } from "../lib/image-canvas";
test("截图翻译申请对齐模型的原生画布后只需缩小", () => {
  assert.equal(modelCanvas("gpt-image-2", 1290, 2796), "1296x2800");
  assert.equal(modelCanvas("gpt-image-2.5-flare", 1290, 2796), "1296x2800");
  assert.equal(modelCanvas("gpt-image-2", 512, 512), "1024x1024");
  assert.equal(modelCanvas("custom", 1290, 2796), "1290x2796");
});

import { fitAppleKeywords } from "../lib/translation-reply";
test("Apple 关键词按 UTF-8 字节保留完整词条", () => {
  const word = "中".repeat(32);
  assert.equal(fitAppleKeywords(word + "，较长词条,a"), word + ",a");
  assert.throws(() => fitAppleKeywords("中".repeat(34)), /完整关键词/);
});

import sharp from "sharp";
import { enlargeTranslation } from "../lib/translation-upscale";
test("翻译图片放大保留颜色、顺序和完整画面，空余边缘以相邻像素补齐", async () => {
  const input = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), {
    raw: { width: 2, height: 1, channels: 3 },
  })
    .png()
    .toBuffer();
  const output = await enlargeTranslation(input, 4, 4);
  const { data, info } = await sharp(output)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [4, 4]);
  for (let y = 0; y < 4; y++)
    assert.deepEqual(
      [...data.subarray(y * 12, y * 12 + 12)],
      [255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0],
    );
  await assert.rejects(enlargeTranslation(input, 1, 1), /保留全部像素/);
});
