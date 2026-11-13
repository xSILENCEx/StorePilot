import test from "node:test";
import assert from "node:assert/strict";
import { readAppleSnapshot } from "../lib/apple-sync";
import { importMissing, textDiff } from "../lib/apple-sync-model";
import { config, mockApple } from "./apple-sync-fixtures";
test("Apple joins application and version fields, follows pagination and preserves source IDs", async () => {
  const snapshot = await readAppleSnapshot(config, "", mockApple());
  assert.equal(snapshot.target.versionId, "v1");
  assert.equal(snapshot.target.versionState, "PREPARE_FOR_SUBMISSION");
  assert.equal(snapshot.locales["en-US"].draft.title, "Remote");
  assert.equal(snapshot.locales["en-US"].draft.description, "Description");
  assert.equal(snapshot.locales["en-US"].appInfoLocalizationId, "il1");
  assert.equal(snapshot.locales["zh-Hans"].versionLocalizationId, null);
});
test("Explicit version and appInfo selection required; no arbitrary first result", async () => {
  await assert.rejects(
    readAppleSnapshot(
      { ...config, fields: { ...config.fields, version: "" } },
      "",
      mockApple(),
    ),
    /目标版本/,
  );
  await assert.rejects(
    readAppleSnapshot(config, "", mockApple({ ambiguous: true })),
    /info2/,
  );
  assert.equal(
    (await readAppleSnapshot(config, "info1", mockApple({ ambiguous: true })))
      .target.appInfoId,
    "info1",
  );
});
test("Reject untrusted pagination before sending credentials; sanitize remote errors", async () => {
  await assert.rejects(
    readAppleSnapshot(config, "", mockApple({ badNext: true })),
    /不可信/,
  );
  await assert.rejects(
    readAppleSnapshot(config, "", mockApple({ fail: true })),
    (e) =>
      e instanceof Error &&
      e.message.includes("403") &&
      !e.message.includes("private remote"),
  );
});
test("Import preserves existing empty drafts and images; difference compares text only", async () => {
  const snapshot = await readAppleSnapshot(config, "", mockApple());
  const existing = {
    title: "",
    subtitle: "",
    description: "",
    keywords: "",
    images: ["/api/assets/" + "a".repeat(64)],
  };
  const drafts = { "apple:en-US": existing, "google:en-US": existing };
  const result = importMissing(drafts, snapshot);
  assert.equal(result["apple:en-US"], existing);
  assert.equal(result["google:en-US"], existing);
  assert.equal(result["apple:zh-Hans"].title, "远端");
  assert.equal(Object.keys(drafts).length, 2);
  assert.deepEqual(
    textDiff(
      { ...snapshot.locales["en-US"].draft, images: existing.images },
      snapshot.locales["en-US"].draft,
    ),
    [],
  );
});
