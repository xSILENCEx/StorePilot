import { z } from "zod";
import type { StoreApp, Platform } from "./model";
// App Store Connect locale shortcodes and Play Console manual translation locales.
// https://developer.apple.com/documentation/appstoreconnectapi/managing-metadata-in-your-app-by-using-locale-shortcodes
// https://support.google.com/googleplay/android-developer/answer/9844778
const codes = {
  apple: [
    "ar-SA",
    "bn-BD",
    "ca",
    "zh-Hans",
    "zh-Hant",
    "hr",
    "cs",
    "da",
    "nl-NL",
    "en-AU",
    "en-CA",
    "en-GB",
    "en-US",
    "fi",
    "fr-FR",
    "fr-CA",
    "de-DE",
    "el",
    "gu-IN",
    "he",
    "hi",
    "hu",
    "id",
    "it",
    "ja",
    "kn-IN",
    "ko",
    "ms",
    "ml-IN",
    "mr-IN",
    "no",
    "or-IN",
    "pl",
    "pt-BR",
    "pt-PT",
    "pa-IN",
    "ro",
    "ru",
    "sk",
    "sl-SI",
    "es-MX",
    "es-ES",
    "sv",
    "ta-IN",
    "te-IN",
    "th",
    "tr",
    "uk",
    "ur-PK",
    "vi",
  ],
  google: [
    "af",
    "sq",
    "am",
    "ar",
    "hy-AM",
    "az-AZ",
    "bn-BD",
    "eu-ES",
    "be",
    "bg",
    "my-MM",
    "ca",
    "zh-HK",
    "zh-CN",
    "zh-TW",
    "hr",
    "cs-CZ",
    "da-DK",
    "nl-NL",
    "en-AU",
    "en-CA",
    "en-US",
    "en-GB",
    "en-IN",
    "en-SG",
    "en-ZA",
    "et",
    "fil",
    "fi-FI",
    "fr-CA",
    "fr-FR",
    "gl-ES",
    "ka-GE",
    "de-DE",
    "el-GR",
    "gu",
    "iw-IL",
    "hi-IN",
    "hu-HU",
    "is-IS",
    "id",
    "it-IT",
    "ja-JP",
    "kn-IN",
    "kk",
    "km-KH",
    "ko-KR",
    "ky-KG",
    "lo-LA",
    "lv",
    "lt",
    "mk-MK",
    "ms-MY",
    "ms",
    "ml-IN",
    "mr-IN",
    "mn-MN",
    "ne-NP",
    "no-NO",
    "fa",
    "fa-AE",
    "fa-AF",
    "fa-IR",
    "pl-PL",
    "pt-BR",
    "pt-PT",
    "pa",
    "ro",
    "rm",
    "ru-RU",
    "sr",
    "si-LK",
    "sk",
    "sl",
    "es-419",
    "es-ES",
    "es-US",
    "sw",
    "sv-SE",
    "ta-IN",
    "te-IN",
    "th",
    "tr-TR",
    "uk",
    "ur",
    "vi",
  ],
};
const names = new Intl.DisplayNames(["zh-CN"], { type: "language" });
function canonical(code: string) {
  try {
    return Intl.getCanonicalLocales(code)[0];
  } catch {
    return code.toLowerCase();
  }
}
export function isPrimaryLocale(code: string, primary?: string) {
  return !!primary && canonical(code) === canonical(primary);
}
export function availableStoreLocales(platform: Platform, existing: string[]) {
  const used = new Set(existing.map(canonical));
  return codes[platform]
    .filter((code) => !used.has(canonical(code)))
    .map((code) => ({ code, name: names.of(code) ?? code }));
}

export const localeCode = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
export function draftLocales(app: StoreApp, platform: Platform) {
  const prefix = platform + ":";
  return Object.keys(app.drafts)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
}
