"use client";
import { fieldLabel, type StoreField } from "../lib/store-fields";
import { readApiResponse } from "../lib/api-response";
import { draftLocales } from "../lib/store-locales";
import { blankDraft } from "../lib/model";
import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { LanguageChecklist } from "./language-checklist";
import { notifications } from "@mantine/notifications";
import { pushContent, type PushSections } from "../lib/push-plan";
import type { StoreApp, Platform } from "../lib/model";
const labels = {
  text: "商店文案",
  screenshots: "设备截图",
  graphics: "商店图片资源",
};

export function StorePushButton({
  app,
  platform,
  locale,
  revision,
  enabled,
}: {
  app: StoreApp;
  platform: Platform;
  locale: string;
  revision: number;
  enabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [step, setStep] = useState(1);
  const [opened, setOpened] = useState(false),
    [targets, setTargets] = useState<string[]>([]),
    [sections, setSections] = useState<PushSections>(["text"]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestId, setId] = useState("");
  const locales = draftLocales(app, platform);
  const previews = targets.map((lang) => ({
    lang,
    ...pushContent(
      platform,
      app.drafts[platform + ":" + lang] ?? blankDraft(),
      sections,
    ),
  }));
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/store-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: app.id,
          platform,
          requestId,
          revision,
          locales: targets,
          sections,
        }),
      });
      const data = await readApiResponse(r);
      notifications.show({ message: "商店推送已加入任务记录" });
      setOpened(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        disabled={!enabled}
        onClick={() => {
          setStep(1);
          setQuery("");
          setTargets([locale]);
          setSections(["text"]);
          setError("");
          setId(crypto.randomUUID());
          setOpened(true);
        }}
      >
        推送到商店
      </Button>
      <Modal
        size="lg"
        opened={opened}
        onClose={() => {
          if (!busy) setOpened(false);
        }}
        title={
          "推送到 " +
          (platform === "apple" ? "App Store Connect" : "Google Play") +
          " · " +
          step +
          "/2"
        }
      >
        <Stack>
          <Text fw={600}>
            {app.name} · {app[platform]}
          </Text>
          {step === 1 ? (
            <>
              <LanguageChecklist
                options={locales}
                targets={targets}
                setTargets={setTargets}
                query={query}
                setQuery={setQuery}
              />
              <Group justify="flex-end">
                <Button
                  disabled={!targets.length || !enabled}
                  onClick={() => setStep(2)}
                >
                  下一步（{targets.length}）
                </Button>
              </Group>
            </>
          ) : (
            <>
              <Group>
                {(Object.keys(labels) as PushSections)
                  .filter((s) => platform === "google" || s !== "graphics")
                  .map((s) => (
                    <Checkbox
                      key={s}
                      checked={sections.includes(s)}
                      disabled={busy}
                      label={labels[s]}
                      onChange={(e) =>
                        setSections(
                          e.currentTarget.checked
                            ? [...sections, s]
                            : sections.filter((k) => k !== s),
                        )
                      }
                    />
                  ))}
              </Group>
              <Text size="sm">
                仅写入下列非空字段。每个列出的图片组将按草稿顺序完整替换商店中的该组图片。
              </Text>
              {previews.map((p) => (
                <Stack key={p.lang} gap={3}>
                  <Text size="sm" fw={600}>
                    {p.lang}
                  </Text>
                  <Text size="sm">
                    {[
                      ...Object.keys(p.fields).map((k) =>
                        fieldLabel(platform, k as StoreField),
                      ),
                      ...Object.entries(p.groups).map(
                        ([group, urls]) => group + "（" + urls.length + " 张）",
                      ),
                    ].join("、")}
                  </Text>
                  {p.errors.map((err) => (
                    <Text size="sm" c="red" key={err}>
                      {err}
                    </Text>
                  ))}
                </Stack>
              ))}
              <Alert color="orange">
                {platform === "apple"
                  ? "写入连接所指向的可编辑版本，不提交审核。Apple 分步保存，失败时可能已有部分内容生效。"
                  : "提交 Google Play edit，可能触发审核或发布。如已有变更在审，推送将停止。"}
              </Alert>
              {error && <Alert color="red">{error}</Alert>}
              <Group justify="flex-end">
                <Button
                  variant="default"
                  disabled={busy}
                  onClick={() => setStep(1)}
                >
                  上一步
                </Button>
                <Button
                  loading={busy}
                  disabled={
                    !enabled ||
                    !targets.length ||
                    !sections.length ||
                    previews.some((p) => p.errors.length)
                  }
                  onClick={() => void submit()}
                >
                  确认推送
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
    </>
  );
}
