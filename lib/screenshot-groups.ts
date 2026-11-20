import type { Draft, Platform } from "./model";

export type DeviceGroup = { value: string; label: string; limit: number };
export const ungrouped = "ungrouped";
export const screenshotDocs = {
  apple:
    "https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/",
  google:
    "https://support.google.com/googleplay/android-developer/answer/9866151",
};

// Offline editor categories follow the public store consoles. Only the Apple
// reference catalog supplies live placement identifiers.
const appleDevices = {
  IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY: "iPhone · 灵动岛中屏",
  IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY: "iPhone · 灵动岛大屏",
  IPHONE_DUO: "iPhone Duo",
  IPHONE_FACE_ID_LARGE_DISPLAY: "iPhone · Face ID 大屏",
  IPHONE_FACE_ID_MEDIUM_DISPLAY: "iPhone · Face ID 中屏",
  IPHONE_HOME_BUTTON_LARGE_DISPLAY: "iPhone · 主屏幕按钮大屏",
  IPHONE_HOME_BUTTON_MEDIUM_DISPLAY: "iPhone · 主屏幕按钮中屏",
  IPHONE_HOME_BUTTON_40_DISPLAY: "iPhone · 4 英寸",
  IPHONE_HOME_BUTTON_35_DISPLAY: "iPhone · 3.5 英寸",
  IPAD_13_DISPLAY: "iPad · 13 英寸",
  IPAD_129_DISPLAY: "iPad · 12.9 英寸",
  IPAD_11_DISPLAY: "iPad · 11 英寸",
  IPAD_105_DISPLAY: "iPad · 10.5 英寸",
  IPAD_97_DISPLAY: "iPad · 9.7 英寸",
  MAC_APP_STORE: "Mac",
  TV_APP_STORE: "Apple TV",
  VISION_PRO_APP_STORE: "Apple Vision Pro",
  WATCH_ULTRA: "Apple Watch Ultra",
  WATCH_SERIES_10: "Apple Watch · Series 10 尺寸",
  WATCH_SERIES_7: "Apple Watch · Series 7 尺寸",
  WATCH_SERIES_4: "Apple Watch · Series 4 尺寸",
  WATCH_SERIES_3: "Apple Watch · Series 3 尺寸",
};
export const googleScreenshotDevices = {
  phoneScreenshots: "手机",
  sevenInchScreenshots: "平板 · 7 英寸",
  tenInchScreenshots: "平板 · 10 英寸",
};
const historicalGoogleDevices: Record<string, string> = {
  foldableSquare: "折叠屏 · 1:1 内屏",
  foldableWide: "折叠屏 · 4:3 内屏",
  chromebook: "Chromebook",
  tvScreenshots: "Android TV",
  wearScreenshots: "Wear OS",
  automotive: "Android Automotive OS",
  androidXR: "Android XR",
};
export function appleGroupLabel(display: string, platform: string, id: string) {
  const labels: Record<string, string> = appleDevices;
  const label = labels[display] ?? labels[platform] ?? id;
  return platform === "IMESSAGE_APP_STORE" ? "iMessage · " + label : label;
}
export function deviceGroups(
  platform: Platform,
  existing: string[],
  catalog?: DeviceGroup[],
) {
  const offline = platform === "apple" ? appleDevices : googleScreenshotDevices;
  const limit = platform === "apple" ? 10 : 8;
  const groups =
    platform === "apple" && catalog?.length
      ? [...catalog]
      : Object.entries(offline).map(([value, label]) => ({
          value,
          label,
          limit,
        }));
  for (const value of existing) {
    if (!groups.some((g) => g.value === value)) {
      const labels: Record<string, string> =
        platform === "google" ? historicalGoogleDevices : offline;
      groups.push({ value, label: labels[value] ?? value, limit });
    }
  }
  return groups;
}
export function groupImages(draft: Draft, group: string) {
  return group === ungrouped
    ? draft.images
    : (draft.screenshotGroups?.[group] ?? []);
}
export function setGroupImages(
  draft: Draft,
  group: string,
  images: string[],
): Partial<Draft> {
  if (group === ungrouped) return { images };
  const groups = { ...draft.screenshotGroups };
  if (images.length) groups[group] = images;
  else delete groups[group];
  return { screenshotGroups: groups };
}
export function allScreenshots(draft: Draft) {
  return [
    ...new Set([
      ...draft.images,
      ...Object.values(draft.screenshotGroups ?? {}).flat(),
    ]),
  ];
}

// Pixel dimensions from App Store Connect Help, Screenshot specifications.
const appleDimensions: Record<string, string[]> = {
  IPHONE_DUO: ["1398 × 2034", "2034 × 1398", "2007 × 2853", "2853 × 2007"],
  IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY: [
    "1260 × 2736",
    "2736 × 1260",
    "1290 × 2796",
    "2796 × 1290",
    "1320 × 2868",
    "2868 × 1320",
  ],
  IPHONE_FACE_ID_LARGE_DISPLAY: [
    "1284 × 2778",
    "2778 × 1284",
    "1242 × 2688",
    "2688 × 1242",
  ],
  IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY: [
    "1179 × 2556",
    "2556 × 1179",
    "1206 × 2622",
    "2622 × 1206",
  ],
  IPHONE_FACE_ID_MEDIUM_DISPLAY: [
    "1170 × 2532",
    "2532 × 1170",
    "1125 × 2436",
    "2436 × 1125",
    "1080 × 2340",
    "2340 × 1080",
  ],
  IPHONE_HOME_BUTTON_LARGE_DISPLAY: ["1242 × 2208", "2208 × 1242"],
  IPHONE_HOME_BUTTON_MEDIUM_DISPLAY: ["750 × 1334", "1334 × 750"],
  IPHONE_HOME_BUTTON_40_DISPLAY: [
    "640 × 1096",
    "640 × 1136",
    "1136 × 600",
    "1136 × 640",
  ],
  IPHONE_HOME_BUTTON_35_DISPLAY: [
    "640 × 920",
    "640 × 960",
    "960 × 600",
    "960 × 640",
  ],
  IPAD_13_DISPLAY: ["2064 × 2752", "2752 × 2064", "2048 × 2732", "2732 × 2048"],
  IPAD_129_DISPLAY: ["2048 × 2732", "2732 × 2048"],
  IPAD_11_DISPLAY: [
    "1488 × 2266",
    "2266 × 1488",
    "1512 × 2316",
    "2316 × 1512",
    "1668 × 2420",
    "2420 × 1668",
    "1668 × 2388",
    "2388 × 1668",
    "1640 × 2360",
    "2360 × 1640",
  ],
  IPAD_105_DISPLAY: ["1668 × 2224", "2224 × 1668"],
  IPAD_97_DISPLAY: [
    "1536 × 2008",
    "1536 × 2048",
    "2048 × 1496",
    "2048 × 1536",
    "768 × 1004",
    "768 × 1024",
    "1024 × 748",
    "1024 × 768",
  ],
  WATCH_ULTRA: ["422 × 514", "410 × 502"],
  WATCH_SERIES_10: ["416 × 496"],
  WATCH_SERIES_7: ["396 × 484"],
  WATCH_SERIES_4: ["368 × 448"],
  WATCH_SERIES_3: ["312 × 390"],
};
export function screenDimensions(device: DeviceGroup) {
  const display = Object.entries(appleDevices).find(
    ([, label]) => label === device.label,
  )?.[0];
  return appleDimensions[device.value] ?? appleDimensions[display ?? ""] ?? [];
}

export const screenModelSizes = new Set(
  Object.values(appleDimensions)
    .flat()
    .map((size) => size.replace(" × ", "x")),
);
