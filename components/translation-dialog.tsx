"use client";
import { readApiResponse } from "../lib/api-response";
import { draftLocales } from "../lib/store-locales";
import { useState } from "react";
import {
  Paper,
  UnstyledButton,
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { ChevronRight } from "lucide-react";
import {
  LanguageChecklist,
  languageLabel as label,
} from "./language-checklist";
import { notifications } from "@mantine/notifications";
import type { StoreApp, Platform } from "../lib/model";
import { translationItems, type TranslationItem } from "../lib/translation";
import { availableStoreLocales } from "../lib/store-locales";

type Props = {
  mode: "add" | "update";
  app: StoreApp;
  platform: Platform;
  locale: string;
  primary?: string;
  revision: number;
  enabled: boolean;
  close: () => void;
  addBlank: (targets: string[]) => void;
};
function SelectionGroup({
  title,
  items,
  selected,
  toggle,
  devices = false,
}: {
  title: string;
  items: TranslationItem[];
  selected: string[];
  toggle: (ids: string[], checked: boolean) => void;
  devices?: boolean;
}) {
  const count = items.filter((i) => selected.includes(i.id)).length;
  const [open, setOpen] = useState(false);
  const groups = new Map<string, TranslationItem[]>();
  if (devices)
    for (const item of items)
      if (item.kind === "screenshot")
        groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  function renderItems(entries: TranslationItem[]) {
    return (
      <div className="translation-item-grid">
        {entries.map((item) => (
          <Checkbox
            key={item.id}
            checked={selected.includes(item.id)}
            label={
              <Group gap="xs" wrap="nowrap">
                {(item.kind === "graphic" || item.kind === "screenshot") && (
                  <img
                    loading="lazy"
                    src={item.value}
                    alt=""
                    width={44}
                    height={50}
                    style={{ objectFit: "contain" }}
                  />
                )}
                {item.label}
              </Group>
            }
            styles={{ body: { alignItems: "center" } }}
            onChange={(e) => toggle([item.id], e.currentTarget.checked)}
          />
        ))}
      </div>
    );
  }
  return (
    <Paper withBorder radius="md" p="md">
      <Group wrap="nowrap" gap="sm">
        <Checkbox
          aria-label={"选择" + title}
          checked={count === items.length}
          indeterminate={count > 0 && count < items.length}
          onChange={(e) =>
            toggle(
              items.map((i) => i.id),
              e.currentTarget.checked,
            )
          }
        />
        <UnstyledButton
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          style={{ flex: 1 }}
        >
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600} size="sm">
              {title}
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed">
                {count} / {items.length}
              </Text>
              <ChevronRight
                className="translation-chevron"
                size={16}
                aria-hidden
              />
            </Group>
          </Group>
        </UnstyledButton>
      </Group>
      <div className="translation-collapse" data-open={open} inert={!open}>
        <div className="translation-clip">
          <Stack className="translation-module-body" gap="md">
            {devices
              ? [...groups].map(([group, entries]) => {
                  const device = entries[0];
                  const label =
                    device.kind === "screenshot" ? device.device : group;
                  const checked = entries.filter((i) =>
                    selected.includes(i.id),
                  ).length;
                  return (
                    <Stack key={group} gap="sm">
                      <Checkbox
                        label={label}
                        styles={{ label: { overflowWrap: "anywhere" } }}
                        checked={checked === entries.length}
                        indeterminate={checked > 0 && checked < entries.length}
                        onChange={(e) =>
                          toggle(
                            entries.map((i) => i.id),
                            e.currentTarget.checked,
                          )
                        }
                      />
                      {renderItems(entries)}
                    </Stack>
                  );
                })
              : renderItems(items)}
          </Stack>
        </div>
      </div>
    </Paper>
  );
}
export function TranslationDialog({
  mode,
  app,
  platform,
  locale,
  primary,
  revision,
  enabled,
  close,
  addBlank,
}: Props) {
  const existing = draftLocales(app, platform);
  const options =
    mode === "add"
      ? availableStoreLocales(platform, existing).map((l) => l.code)
      : existing.filter((l) => l !== locale);
  const getItems = (code: string) =>
    translationItems(platform, app.drafts[platform + ":" + code]);
  const defaultSource =
    mode === "update"
      ? locale
      : ([primary, locale, ...existing].find(
          (code): code is string => !!code && getItems(code).length > 0,
        ) ?? locale);
  const [configured, setConfigured] = useState(false);
  const [source, setSource] = useState(defaultSource);
  const [selected, setSelected] = useState<string[]>(() =>
    getItems(defaultSource).map((i) => i.id),
  );
  const [targets, setTargets] = useState<string[]>([]);
  const [step, setStep] = useState(1);

  const [method, setMethod] = useState("ai");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const items = getItems(source);
  const imageCount =
    items.filter(
      (i) =>
        selected.includes(i.id) &&
        (i.kind === "screenshot" || i.kind === "graphic"),
    ).length * targets.length;
  const sections = [...new Set(items.map((i) => i.section))];
  function toggle(ids: string[], checked: boolean) {
    setSelected((prev) =>
      checked
        ? [...new Set([...prev, ...ids])]
        : prev.filter((id) => !ids.includes(id)),
    );
  }
  async function submit() {
    if (method === "blank") {
      addBlank(targets);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/translations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: app.id,
          platform,
          source,
          targets,
          mode,
          selected,

          revision,
        }),
      });
      const data = await readApiResponse(response);
      notifications.show({
        message: `已提交 ${targets.length} 种语言的翻译，可在任务记录中查看进度。`,
      });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      opened
      onClose={() => {
        if (!busy) close();
      }}
      size={step === 2 ? "58rem" : "md"}
      title={(mode === "add" ? "添加语言" : "翻译草稿") + " · " + step + "/2"}
    >
      <Stack>
        {step === 1 ? (
          <>
            <LanguageChecklist
              options={options}
              targets={targets}
              setTargets={setTargets}
              query={query}
              setQuery={setQuery}
            />
            <Group justify="flex-end">
              <Button
                disabled={!targets.length}
                onClick={() => {
                  if (!configured) {
                    setSource(defaultSource);
                    setSelected(getItems(defaultSource).map((i) => i.id));
                    setConfigured(true);
                  }
                  setStep(2);
                }}
              >
                下一步（{targets.length}）
              </Button>
            </Group>
          </>
        ) : (
          <>
            <Stack gap={6}>
              <Text size="sm" fw={600}>
                目标语言（{targets.length}）
              </Text>
              <Group gap={6} mah="18dvh" style={{ overflowY: "auto" }}>
                {targets.map((code) => (
                  <Text
                    key={code}
                    component="span"
                    size="xs"
                    className="translation-language"
                  >
                    {label(code)}
                  </Text>
                ))}
              </Group>
            </Stack>
            {mode === "add" && (
              <SegmentedControl
                value={method}
                onChange={setMethod}
                data={[
                  { label: "AI 翻译", value: "ai" },
                  { label: "空白模板", value: "blank" },
                ]}
              />
            )}
            {method === "ai" && (
              <>
                <Select
                  label="来源语言"
                  value={source}
                  disabled={mode === "update"}
                  data={existing.map((value) => ({
                    value,
                    label:
                      label(value) + (value === primary ? "（商店默认）" : ""),
                  }))}
                  onChange={(code) => {
                    if (code) {
                      setSource(code);
                      setSelected(getItems(code).map((i) => i.id));
                    }
                  }}
                />
                <Text fw={600} size="sm">
                  翻译内容
                </Text>
                {sections.map((section) => (
                  <SelectionGroup
                    key={source + section}
                    title={section}
                    items={items.filter((i) => i.section === section)}
                    selected={selected}
                    toggle={toggle}
                    devices={section === "商店截图"}
                  />
                ))}
                {!items.length && (
                  <Text size="sm" c="dimmed">
                    来源草稿没有可翻译内容。
                  </Text>
                )}
                {imageCount > 0 && (
                  <Text size="sm">
                    图片按顺序自动处理。返回图片会居中裁剪到目标比例，尺寸不足时按原像素放大。
                  </Text>
                )}
                <Text size="sm" c="dimmed">
                  {source} → {targets.length} 种语言，每种处理 {selected.length}{" "}
                  项。{imageCount > 0 && "共需处理 " + imageCount + " 张图片。"}
                  {mode === "update"
                    ? "已勾选的字段和对应序号的图片将被覆盖。"
                    : ""}
                  每种语言全部成功后保存。
                </Text>
              </>
            )}
            {error && <Alert color="red">{error}</Alert>}
            <Group justify="space-between">
              <Button
                variant="default"
                disabled={busy}
                onClick={() => setStep(1)}
              >
                上一步
              </Button>
              <Button
                loading={busy}
                disabled={!enabled || (method === "ai" && !selected.length)}
                onClick={() => void submit()}
              >
                {method === "blank" ? "创建空白草稿" : "开始翻译"}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
