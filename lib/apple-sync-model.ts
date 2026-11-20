import type { DeviceGroup } from "./screenshot-groups";
import type { Draft } from "./model";
export const textFields = [
  "title",
  "subtitle",
  "description",
  "keywords",
  "promotionalText",
  "whatsNew",
  "supportUrl",
  "marketingUrl",
  "privacyPolicyUrl",
  "privacyChoicesUrl",
] as const;
export type AppleScreenshot = {
  id: string;
  assetId: string;
  deviceType: string;
  fileName: string;
  width: number;
  height: number;
  state: string;
  sourceUrl: string | null;
  url: string | null;
};
export type AppleSnapshot = {
  deviceGroups?: DeviceGroup[];
  metadata: {
    name: string;
    primaryLocale: string;
    sku: string;
    copyright: string;
    releaseType: string;
    earliestReleaseDate: string;
    primaryCategoryId: string;
    secondaryCategoryId: string;
    ageRating: string;
  };
  warnings: string[];
  target: {
    appId: string;
    bundleId: string;
    platform: string;
    version: string;
    versionId: string;
    versionState: string;
    appInfoId: string;
    appInfoState: string;
  };
  locales: Record<
    string,
    {
      draft: Draft;
      screenshots: AppleScreenshot[];
      appInfoLocalizationId: string | null;
      versionLocalizationId: string | null;
    }
  >;
  fetchedAt: string;
};
export function textDiff(local: Draft | undefined, remote: Draft) {
  return textFields.filter(
    (field) => !local || (local[field] ?? "") !== (remote[field] ?? ""),
  );
}
// Only missing languages are imported. Existing drafts (including intentionally empty ones) are never replaced.
export function importMissing(
  drafts: Record<string, Draft>,
  snapshot: AppleSnapshot,
) {
  const next = { ...drafts };
  for (const [locale, value] of Object.entries(snapshot.locales)) {
    const key = `apple:${locale}`;
    if (!Object.hasOwn(next, key)) next[key] = { ...value.draft, images: [] };
  }
  return next;
}

export function appleDeviceLabel(type: string) {
  const known: Record<string, string> = {
    APP_IPHONE_67: "iPhone 6.7 英寸",
    APP_IPHONE_65: "iPhone 6.5 英寸",
    APP_IPHONE_55: "iPhone 5.5 英寸",
    APP_IPAD_PRO_3GEN_129: "iPad Pro 12.9 英寸",
    IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE: "iPhone 大屏",
  };
  return (
    known[type] ??
    (type.includes("IMESSAGE")
      ? "iMessage"
      : type.includes("IPHONE")
        ? "iPhone"
        : type.includes("IPAD")
          ? "iPad"
          : type.includes("DESKTOP") || type.includes("MAC")
            ? "Mac"
            : type.includes("TV")
              ? "Apple TV"
              : type.includes("VISION")
                ? "Apple Vision"
                : "其他设备")
  );
}
