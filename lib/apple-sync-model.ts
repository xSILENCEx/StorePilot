import { screenshotGroup } from "./screenshot-groups";
import { storeFields } from "./store-fields";
import { blankDraft } from "./model";
import type { DeviceGroup } from "./screenshot-groups";
import type { Draft, Platform, GraphicType } from "./model";
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
export function textDiff(
  local: Draft | undefined,
  remote: Draft,
  platform: Platform = "apple",
) {
  return storeFields[platform].filter(
    (field) => !local || (local[field] ?? "") !== (remote[field] ?? ""),
  );
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

export type ImportSection = "metadata" | "screenshots" | "graphics";
export function snapshotIdentity(snapshot: AppleSnapshot | GoogleSnapshot) {
  return "packageName" in snapshot
    ? {
        identifier: snapshot.packageName,
        primary: snapshot.details?.defaultLanguage,
      }
    : {
        identifier: snapshot.target.bundleId,
        primary: snapshot.metadata?.primaryLocale,
      };
}
type ImportSnapshot = {
  locales: StoreLocales;
  deviceGroups?: AppleSnapshot["deviceGroups"];
};
export function canImportLocale(
  snapshot: ImportSnapshot,
  language: string,
  platform: Platform,
  section: ImportSection,
) {
  const entry = snapshot.locales[language];
  if (!entry) return false;
  if (section === "metadata") return true;
  if (section === "graphics")
    return (
      platform === "google" &&
      Object.values(entry.graphics ?? {}).some((image) => image.url)
    );
  const shots = entry.screenshots;
  return (
    !!shots?.length &&
    shots.every((image) => image.url) &&
    Object.entries(Object.groupBy(shots, (image) => image.deviceType)).every(
      ([device, images]) =>
        (images?.length ?? 0) <=
        screenshotGroup(platform, device, snapshot.deviceGroups).limit,
    )
  );
}
export function overwriteStoreDrafts(
  drafts: Record<string, Draft>,
  snapshot: ImportSnapshot,
  platform: Platform,
  section: ImportSection,
  languages: string[],
) {
  const next = { ...drafts };
  for (const language of languages) {
    const entry = snapshot.locales[language];
    if (!canImportLocale(snapshot, language, platform, section)) continue;
    const key = platform + ":" + language;
    const draft: Draft = {
      ...(drafts[key] ?? blankDraft()),
    };
    if (section === "metadata") {
      for (const field of storeFields[platform])
        draft[field] = entry.draft[field] ?? "";
    } else if (section === "screenshots") {
      const groups: Record<string, string[]> = {};
      for (const image of entry.screenshots)
        (groups[image.deviceType] ??= []).push(image.url!);
      draft.screenshotGroups = groups;
      draft.images = [];
    } else {
      draft.graphics = Object.fromEntries(
        Object.entries(entry.graphics ?? {}).flatMap(([type, image]) =>
          image.url ? [[type, image.url]] : [],
        ),
      );
    }
    next[key] = draft;
  }
  return next;
}
