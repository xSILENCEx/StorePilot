import test from "node:test";
import assert from "node:assert/strict";
import { readAppleSnapshot } from "../lib/apple-sync";
import {
  canImportLocale,
  overwriteStoreDrafts,
  importMissing,
  textDiff,
} from "../lib/apple-sync-model";
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
test("Blank version selects published first, otherwise latest; app info follows the selected version state", async () => {
  const withoutVersion = {
    ...config,
    fields: { ...config.fields, version: "" },
  };
  const snapshot = await readAppleSnapshot(
    withoutVersion,
    "",
    mockApple({
      ambiguous: true,
      versions: [
        {
          id: "draft-2",
          attributes: {
            platform: "IOS",
            versionString: "2.0",
            appVersionState: "PREPARE_FOR_SUBMISSION",
          },
        },
        {
          id: "live-1",
          attributes: {
            platform: "IOS",
            versionString: "1.0",
            appVersionState: "READY_FOR_DISTRIBUTION",
          },
        },
      ],
    }),
  );
  assert.equal(snapshot.target.versionId, "live-1");
  assert.equal(snapshot.target.appInfoId, "info2");
  const latest = await readAppleSnapshot(
    withoutVersion,
    "",
    mockApple({
      versions: [
        {
          id: "v9",
          attributes: {
            platform: "IOS",
            versionString: "1.9",
            appVersionState: "PREPARE_FOR_SUBMISSION",
          },
        },
        {
          id: "v10",
          attributes: {
            platform: "IOS",
            versionString: "1.10",
            appVersionState: "PREPARE_FOR_SUBMISSION",
          },
        },
      ],
    }),
  );
  assert.equal(latest.target.version, "1.10");
  await assert.rejects(
    readAppleSnapshot(
      config,
      "",
      mockApple({ ambiguous: true, sameState: true }),
    ),
    /info2/,
  );
  assert.equal(
    (
      await readAppleSnapshot(
        config,
        "info1",
        mockApple({ ambiguous: true, sameState: true }),
      )
    ).target.appInfoId,
    "info1",
  );
});
test("Reads metadata and ordered screenshot placements per device, with legacy API fallback", async () => {
  const current = await readAppleSnapshot(
    config,
    "",
    mockApple({ screenshots: true }),
  );
  assert.equal(current.metadata.primaryLocale, "en-US");
  assert.equal(current.metadata.copyright, "2026 Fixture");
  assert.equal(current.locales["en-US"].draft.promotionalText, "A useful app");
  assert.equal(
    current.locales["en-US"].draft.supportUrl,
    "https://example.com/support",
  );
  assert.equal(current.locales["en-US"].screenshots.length, 2);
  assert.equal(current.locales["en-US"].screenshots[0].id, "placement-1");
  assert.equal(
    current.locales["en-US"].screenshots[1].deviceType,
    "IPAD_PRO_3GEN_129",
  );
  assert.match(
    current.locales["en-US"].screenshots[0].sourceUrl!,
    /80x120bb.png$/,
  );
  const legacy = await readAppleSnapshot(
    config,
    "",
    mockApple({ screenshots: true, legacy: true }),
  );
  assert.equal(
    legacy.locales["en-US"].screenshots[0].deviceType,
    "APP_IPHONE_67",
  );
  await assert.rejects(
    readAppleSnapshot(
      config,
      "",
      mockApple({ screenshots: true, badImage: true }),
    ),
    /截图地址/,
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

test("快照分组超过目录上限时，语言选择和实际导入都保留原草稿", async () => {
  const snapshot = await readAppleSnapshot(
    config,
    "",
    mockApple({ screenshots: true }),
  );
  const shot = snapshot.locales["en-US"].screenshots[0];
  assert.ok(shot);
  snapshot.deviceGroups = [{ value: shot.deviceType, label: "设备", limit: 1 }];
  const saved = { ...shot, url: "/api/assets/" + "a".repeat(64) };
  snapshot.locales["en-US"].screenshots = [saved, saved];
  const drafts = { "apple:en-US": snapshot.locales["en-US"].draft };
  assert.equal(
    canImportLocale(snapshot, "en-US", "apple", "screenshots"),
    false,
  );
  assert.deepEqual(
    overwriteStoreDrafts(drafts, snapshot, "apple", "screenshots", ["en-US"]),
    drafts,
  );
});
