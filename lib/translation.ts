import { screenshotGroup } from "./screenshot-groups";
import {
  draftFields,
  fieldLabel,
  type StoreField as Field,
} from "./store-fields";
import {
  graphicLabels,
  graphicTypes,
  type Draft,
  type Platform,
} from "./model";
import { groupImages, setGroupImages, ungrouped } from "./screenshot-groups";

type Common = { id: string; label: string; section: string; value: string };
export type TranslationItem = Common &
  (
    | { kind: "text" | "link"; field: Field }
    | { kind: "graphic"; field: keyof typeof graphicLabels }
    | { kind: "screenshot"; group: string; index: number; device: string }
  );
export function translationItems(platform: Platform, draft?: Draft) {
  const items: TranslationItem[] = [];
  if (!draft) return items;
  for (const field of draftFields[platform]) {
    const value = draft[field];
    if (!value?.trim()) continue;
    const link = field === "video" || field.endsWith("Url");
    const label = fieldLabel(platform, field);
    items.push({
      id: field,
      field,
      label,
      value,
      section: link ? "网址（原样复制）" : "商店文案",
      kind: link ? "link" : "text",
    });
  }
  for (const group of [
    ungrouped,
    ...Object.keys(draft.screenshotGroups ?? {}),
  ]) {
    const device =
      group === ungrouped ? "未分组" : screenshotGroup(platform, group).label;
    groupImages(draft, group).forEach((value, index) =>
      items.push({
        id: group + ":" + index,
        value,
        label: "截图 " + (index + 1),
        section: "商店截图",
        kind: "screenshot",
        group,
        index,
        device,
      }),
    );
  }
  if (platform === "google")
    for (const field of graphicTypes) {
      const value = draft.graphics?.[field];
      if (value)
        items.push({
          id: "graphic:" + field,
          kind: "graphic",
          field,
          section: "商店图片资源",
          value,
          label: graphicLabels[field],
        });
    }
  return items;
}
export function applyTranslation(
  draft: Draft,
  items: TranslationItem[],
  values: Record<string, string>,
): Draft {
  let next = structuredClone(draft);
  for (const item of items) {
    const value = values[item.id];
    if (!value) throw new Error("翻译结果不完整");
    if (item.kind === "screenshot") {
      const images = [...groupImages(next, item.group)];
      images[Math.min(item.index, images.length)] = value;
      next = { ...next, ...setGroupImages(next, item.group, images) };
    } else if (item.kind === "graphic") {
      next.graphics = { ...next.graphics, [item.field]: value };
    } else next[item.field] = value;
  }
  return next;
}
