import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appSchema, type Draft } from "../lib/model";
import {
  allScreenshots,
  groupImages,
  setGroupImages,
  deviceGroups,
  ungrouped,
} from "../lib/screenshot-groups";
import { parseAppleDeviceCatalog } from "../lib/apple-device-catalog";

const url = "/api/assets/" + "a".repeat(64);
const legacy: Draft = {
  title: "",
  subtitle: "",
  description: "",
  keywords: "",
  images: [url],
};
test("legacy drafts keep their unassigned screenshots and device groups have independent order", () => {
  let draft = {
    ...legacy,
    ...setGroupImages(legacy, "phoneScreenshots", [url]),
  };
  assert.deepEqual(groupImages(draft, ungrouped), [url]);
  draft = { ...draft, ...setGroupImages(draft, ungrouped, []) };
  assert.deepEqual(allScreenshots(draft), [url]);
  assert.deepEqual(groupImages(draft, "tenInchScreenshots"), []);
  assert.deepEqual(groupImages(draft, "phoneScreenshots"), [url]);
});
test("Google defaults to phone and tablets and keeps existing device groups accessible", () => {
  const defaults = deviceGroups("google", []);
  assert.deepEqual(
    defaults.map((group) => group.value),
    ["phoneScreenshots", "sevenInchScreenshots", "tenInchScreenshots"],
  );
  assert.deepEqual(deviceGroups("google", ["wearScreenshots"]), [
    ...defaults,
    { value: "wearScreenshots", label: "Wear OS", limit: 8 },
  ]);
});
test("device limits are scoped to each platform and device group", () => {
  const images = Array.from(
    { length: 9 },
    (_, i) => "/api/assets/" + String(i).repeat(64),
  );
  const draft = { ...legacy, screenshotGroups: { phoneScreenshots: images } };
  const app = {
    id: randomUUID(),
    name: "Test",
    apple: "test",
    google: "com.test",
  };
  assert.equal(
    appSchema.safeParse({ ...app, drafts: { "apple:en-US": draft } }).success,
    true,
  );
  assert.equal(
    appSchema.safeParse({ ...app, drafts: { "google:en-US": draft } }).success,
    false,
  );
  assert.equal(
    appSchema.safeParse({ ...app, drafts: { "google:en-US": legacy } }).success,
    true,
  );
});
test("Apple reference data selects version screenshot groups and preserves unknown and historical identifiers", () => {
  const catalog = parseAppleDeviceCatalog({
    features: [
      {
        featureId: "APP_STORE_VERSIONS",
        placementPolicies: [
          {
            placementType: "APP_SCREENSHOT",
            groupLimits: [{ groupIds: ["NEW_PROFILE"], maxCount: 7 }],
          },
          {
            placementType: "APP_PREVIEW",
            groupLimits: [{ groupIds: ["VIDEO"], maxCount: 3 }],
          },
        ],
      },
    ],
    placementProfileGroups: ["NEW_PROFILE", "VIDEO"].map((id) => ({
      placementProfileGroupId: id,
      displayClassId: "NEW_DISPLAY",
      platform: "IPHONE_APP_STORE",
    })),
  });
  assert.deepEqual(
    deviceGroups("apple", ["OLD_PROFILE"], catalog).map((g) => [
      g.value,
      g.limit,
    ]),
    [
      ["NEW_PROFILE", 7],
      ["OLD_PROFILE", 10],
    ],
  );
});
