import { z } from "zod";
import { textFields, googleTextFields } from "./apple-sync-model";
import {
  graphicTypes,
  validateDraft,
  type Platform,
  type Draft,
} from "./model";
export const pushSections = z
  .array(z.enum(["text", "screenshots", "graphics"]))
  .min(1);
export type PushSections = z.infer<typeof pushSections>;
export function pushContent(
  platform: Platform,
  draft: Draft,
  sections: PushSections,
) {
  const fields: Record<string, string> = {};
  if (sections.includes("text"))
    for (const key of platform === "apple" ? textFields : googleTextFields) {
      const value = draft[key];
      if (value?.trim()) fields[key] = value;
    }
  const groups: Record<string, string[]> = {};
  if (sections.includes("screenshots"))
    for (const [key, urls] of Object.entries(draft.screenshotGroups ?? {}))
      if (urls.length) groups[key] = urls;
  if (platform === "google" && sections.includes("graphics"))
    for (const type of graphicTypes) {
      const url = draft.graphics?.[type];
      if (url) groups[type] = [url];
    }
  const errors = sections.includes("text")
    ? validateDraft(platform, draft)
    : [];
  if (sections.includes("screenshots") && draft.images.length)
    errors.push("请先将未分组截图分配到设备组");
  if (!Object.keys(fields).length && !Object.keys(groups).length)
    errors.push("所选模块没有可推送内容");
  return { fields, groups, errors };
}
export type PushContent = ReturnType<typeof pushContent>;
