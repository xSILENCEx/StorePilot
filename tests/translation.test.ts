import test from "node:test";
import assert from "node:assert/strict";
import {
  translationItems,
  applyTranslation,
  blankDraft,
} from "../lib/translation";
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
