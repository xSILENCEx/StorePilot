import type { Draft } from "./model";
export const textFields = [
  "title",
  "subtitle",
  "description",
  "keywords",
] as const;
export type AppleSnapshot = {
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
      appInfoLocalizationId: string | null;
      versionLocalizationId: string | null;
    }
  >;
  fetchedAt: string;
};
export function textDiff(local: Draft | undefined, remote: Draft) {
  return textFields.filter((field) => !local || local[field] !== remote[field]);
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
