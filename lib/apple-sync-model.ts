import type { DeviceGroup } from "./screenshot-groups";
import type { Draft, Platform, GraphicType } from "./model";
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
  icon?: AppleScreenshot;
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
export type StoreLocales = Record<
  string,
  {
    draft: Draft;
    screenshots: AppleScreenshot[];
    graphics?: Partial<Record<GraphicType, AppleScreenshot>>;
  }
>;
export type GoogleSnapshot = {
  packageName: string;
  icon?: AppleScreenshot;
  details?: {
    defaultLanguage?: string;
    contactWebsite?: string;
    contactEmail?: string;
    contactPhone?: string;
  };
  fetchedAt: string;
  warnings: string[];
  locales: StoreLocales;
};
export const googleTextFields = [
  "title",
  "subtitle",
  "description",
  "video",
] as const;
export function textDiff(
  local: Draft | undefined,
  remote: Draft,
  platform: Platform = "apple",
) {
  return (
    platform === "apple" ? [...textFields] : [...googleTextFields]
  ).filter((field) => !local || (local[field] ?? "") !== (remote[field] ?? ""));
}
// Only missing languages are imported. Existing drafts (including intentionally empty ones) are never replaced.
export function importMissing(
  drafts: Record<string, Draft>,
  snapshot: { locales: StoreLocales },
  platform: Platform = "apple",
) {
  const next = { ...drafts };
  for (const [locale, value] of Object.entries(snapshot.locales)) {
    const key = `${platform}:${locale}`;
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
