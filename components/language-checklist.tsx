"use client";
import { Checkbox, Stack, Text, TextInput } from "@mantine/core";
const names = new Intl.DisplayNames(["zh-CN"], { type: "language" });
export const languageLabel = (code: string) => {
  try {
    return (names.of(code) ?? code) + " · " + code;
  } catch {
    return code;
  }
};

export function LanguageChecklist({
  options,
  targets,
  setTargets,
  query,
  setQuery,
  primary,
}: {
  options: string[];
  targets: string[];
  setTargets: (value: string[]) => void;
  query: string;
  primary?: string;
  setQuery: (query: string) => void;
}) {
  const filtered = options.filter((code) =>
    languageLabel(code).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selectedMatches = filtered.filter((code) =>
    targets.includes(code),
  ).length;
  return (
    <>
      <Text fw={600}>选择目标语言</Text>
      <TextInput
        aria-label="搜索目标语言"
        placeholder="搜索语言名称或代码"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <Checkbox
        label={query.trim() ? "全选搜索结果" : "全选"}
        disabled={!filtered.length}
        checked={filtered.length > 0 && selectedMatches === filtered.length}
        indeterminate={selectedMatches > 0 && selectedMatches < filtered.length}
        onChange={(event) => {
          const checked = event.currentTarget.checked;
          setTargets(
            checked
              ? [...new Set([...targets, ...filtered])]
              : targets.filter((code) => !filtered.includes(code)),
          );
        }}
      />
      <Stack gap="sm" mah="48dvh" style={{ overflowY: "auto" }}>
        {filtered.map((code) => (
          <Checkbox
            key={code}
            label={
              languageLabel(code) + (code === primary ? "（商店默认）" : "")
            }
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
    </>
  );
}
