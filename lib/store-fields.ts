import type { Platform } from "./model";
const labels = {
  title: "应用名称",
  subtitle: "副标题",
  description: "完整描述",
  keywords: "关键词",
  promotionalText: "推广文本",
  whatsNew: "版本更新说明",
  video: "宣传视频网址",
  supportUrl: "支持网址",
  marketingUrl: "营销网址",
  privacyPolicyUrl: "隐私政策网址",
  privacyChoicesUrl: "隐私选择网址",
};
const textFields = [
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
const googleDraftFields = [
  "title",
  "subtitle",
  "description",
  "keywords",
  "video",
] as const;
export const draftFields = { apple: textFields, google: googleDraftFields };
const googleTextFields = googleDraftFields.filter((key) => key !== "keywords");
export const storeFields = { apple: textFields, google: googleTextFields };
export type StoreField = keyof typeof labels;
export function fieldLabel(platform: Platform, field: StoreField) {
  if (platform === "google" && field === "subtitle") return "简短描述";
  if (platform === "google" && field === "keywords") return "内部备注";
  return labels[field];
}
