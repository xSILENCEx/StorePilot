"use client";
import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
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
  return (
    <Stack gap="xs">
      <Group gap="xs">
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
        <Button
          variant="subtle"
          size="compact-sm"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "▾" : "▸"} {title}（{count}/{items.length}）
        </Button>
      </Group>
      {open && (
        <Stack pl="xl" gap="xs">
          {devices
            ? [...groups].map(([group, entries]) => (
                <SelectionGroup
                  key={group}
                  title={
                    entries[0].kind === "screenshot" ? entries[0].device : group
                  }
                  items={entries}
                  selected={selected}
                  toggle={toggle}
                />
              ))
            : items.map((i) => (
                <Checkbox
                  key={i.id}
                  checked={selected.includes(i.id)}
                  label={
                    <Group gap="xs">
                      {(i.kind === "graphic" || i.kind === "screenshot") && (
                        <img
                          src={i.value}
                          alt=""
                          width={38}
                          height={38}
                          style={{ objectFit: "contain" }}
                        />
                      )}
                      {i.label}
                    </Group>
                  }
                  onChange={(e) => toggle([i.id], e.currentTarget.checked)}
                />
              ))}
        </Stack>
      )}
    </Stack>
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
  const existing = Object.keys(app.drafts)
    .filter((k) => k.startsWith(platform + ":"))
    .map((k) => k.split(":")[1]);
  const names = new Intl.DisplayNames(["zh-CN"], { type: "language" });
  const label = (code: string) => {
    try {
      return (names.of(code) ?? code) + " · " + code;
    } catch {
      return code;
    }
  };
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
  const filtered = options.filter((code) =>
    label(code).toLowerCase().includes(query.trim().toLowerCase()),
  );
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
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
      size="md"
      title={(mode === "add" ? "添加语言" : "翻译草稿") + " · " + step + "/2"}
    >
      <Stack>
        {step === 1 ? (
          <>
            <Text fw={600}>选择目标语言</Text>
            <TextInput
              aria-label="搜索目标语言"
              placeholder="搜索语言名称或代码"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            <Stack gap="sm" mah="48dvh" style={{ overflowY: "auto" }}>
              {filtered.map((code) => (
                <Checkbox
                  key={code}
                  label={label(code)}
                  checked={targets.includes(code)}
                  onChange={(e) =>
                    setTargets(
                      e.currentTarget.checked
                        ? [...targets, code]
                        : targets.filter((c) => c !== code),
                    )
                  }
                />
              ))}
              {!filtered.length && (
                <Text size="sm" c="dimmed">
                  没有可选择的语言
                </Text>
              )}
            </Stack>
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
            <Text size="sm">目标语言 · {targets.map(label).join("、")}</Text>
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
