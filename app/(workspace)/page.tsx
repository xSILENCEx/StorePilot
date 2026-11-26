"use client";
import { settingsUrl } from "../../components/connection-fields";
import { readApiResponse } from "../../lib/api-response";
import { draftLocales } from "../../lib/store-locales";
import { blankDraft } from "../../lib/model";
import { downloadBlob } from "../../lib/download-blob";
import {
  WorkspaceLink,
  useWorkspaceDrafts,
  useWorkspaceNavigation,
} from "../../components/workspace-shell";
import { StoreCopyEditor } from "../../components/store-copy-editor";
import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ArrowLeft, ArrowRight, Plus, Settings2, Trash2 } from "lucide-react";
import type { DeviceGroup } from "../../lib/screenshot-groups";
import {
  availableStoreLocales,
  isPrimaryLocale,
} from "../../lib/store-locales";
import { TranslationDialog } from "../../components/translation-dialog";
import { StoreGraphicsEditor } from "../../components/store-graphics-editor";
import { ScreenshotList } from "../../components/screenshot-list";
import { StorePushButton } from "../../components/store-push-button";
import { StoreSyncPanel } from "../../components/store-sync-panel";
import { overwriteStoreDrafts } from "../../lib/apple-sync-model";
import type { Draft, Platform, StoreApp } from "../../lib/model";
import { WorkspaceAppList } from "../../components/workspace-app-list";
import { AppSettingsDialog } from "../../components/app-settings-dialog";

export default function Home() {
  const [message, setMessage] = useState("");
  const { apps, ready, saved, blocked, persist, retry, revision } =
    useWorkspaceDrafts();
  const [selected, select] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>("apple");
  const [catalog, setCatalog] = useState<DeviceGroup[]>();
  const [locale, setLocale] = useState("en-US");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [languageModal, setLanguageModal] = useState<"add" | "update" | null>(
    null,
  );
  const [primary, setPrimaryLocale] = useState<{
    scope: string;
    locale?: string;
  }>();
  const [deleteLanguage, setDeleteLanguage] = useState(false);
  const [validating, setValidating] = useState(false);
  const [connection, setConnection] = useState<{
    appId: string;
    platform: string;
    configured: boolean;
    verified: boolean;
  } | null>(null);
  const app = apps.find((a) => a.id === selected);
  const primaryLoaded =
    !!app &&
    primary?.scope === JSON.stringify([app.id, platform, app[platform]]);
  const primaryLocale = primaryLoaded ? primary?.locale : undefined;
  const protectedLocale = isPrimaryLocale(locale, primaryLocale);
  const draftKey = `${platform}:${locale}`;
  const draft = app?.drafts[draftKey] ?? blankDraft();
  const locales = app ? draftLocales(app, platform) : [];
  const candidates = availableStoreLocales(platform, locales);
  const editable = ready && !blocked;
  const connectionConfigured =
    connection?.appId === selected &&
    connection.platform === platform &&
    connection.configured;
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void fetch(settingsUrl(platform, selected), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        if (!controller.signal.aborted)
          setConnection({
            appId: selected,
            platform,
            configured: data.configured,
            verified: data.verified,
          });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [selected, platform]);
  function update(
    patch: Partial<Draft> | ((current: Draft) => Partial<Draft>),
  ) {
    if (!app) return;
    persist((current) =>
      current.map((a) => {
        if (a.id !== app.id || !a.drafts[draftKey]) return a;
        const currentDraft = a.drafts[draftKey];
        return {
          ...a,
          drafts: {
            ...a.drafts,
            [draftKey]: {
              ...currentDraft,
              ...(typeof patch === "function" ? patch(currentDraft) : patch),
            },
          },
        };
      }),
    );
  }
  function openApp(value: StoreApp) {
    setCatalog(undefined);
    select(value.id);
    const p = value.apple ? "apple" : "google";
    setPlatform(p);
    setLocale(draftLocales(value, p)[0] ?? "en-US");
  }
  function openSettings(value?: StoreApp) {
    setEditing(value?.id ?? null);
    setModal(true);
  }
  function create(name: string, apple: string, google: string) {
    const id = editing ?? crypto.randomUUID();
    const existing = apps.find((a) => a.id === editing);
    const next = {
      id,
      name: name.trim(),
      apple: apple.trim(),
      google: google.trim(),
      drafts: {
        ...(apple.trim() ? { "apple:en-US": blankDraft() } : {}),
        ...(google.trim() ? { "google:en-US": blankDraft() } : {}),
        ...existing?.drafts,
      },
    };
    if (
      persist((current) =>
        editing
          ? current.map((a) => (a.id === editing ? next : a))
          : [...current, next],
      )
    ) {
      openApp(next);
      setModal(false);
    }
  }
  function addLanguages(codes: string[]) {
    if (
      !app ||
      !editable ||
      !codes.every((code) => candidates.some((option) => option.code === code))
    )
      return;
    const additions = Object.fromEntries(
      codes.map((code) => [platform + ":" + code, blankDraft()]),
    );
    const added = persist((current) =>
      current.map((a) =>
        a.id === app.id
          ? {
              ...a,
              drafts: {
                ...a.drafts,
                ...Object.fromEntries(
                  Object.entries(additions).filter(([key]) => !a.drafts[key]),
                ),
              },
            }
          : a,
      ),
    );
    if (added) {
      setLocale(codes[0]);
      setLanguageModal(null);
    }
  }
  function download() {
    downloadBlob(
      new Blob([JSON.stringify(apps, null, 2)], { type: "application/json" }),
      "storepilot-drafts.json",
    );
  }
  async function validate() {
    if (!app || !saved) return;
    setValidating(true);
    try {
      const r = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: app.id, platform }),
      });
      const data = await readApiResponse(r);
      notifications.show({
        title: "已提交草稿校验",
        message: "可在左侧任务记录中查看结果。",
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "入队失败");
    } finally {
      setValidating(false);
    }
  }
  useWorkspaceNavigation(app?.name, app?.id);
  return (
    <>
      <Stack gap="xl">
        {message && (
          <Alert color="orange" withCloseButton onClose={() => setMessage("")}>
            {message}
          </Alert>
        )}
        {blocked && (
          <Alert color="red" title="自动保存已暂停">
            <Group justify="space-between">
              <Text size="sm">
                当前内容仍保留在页面中，可导出备份后处理冲突。
              </Text>
              <Group>
                <Button
                  size="xs"
                  variant="white"
                  color="red"
                  onClick={download}
                >
                  导出草稿
                </Button>
                <Button size="xs" color="red" onClick={retry}>
                  重试保存
                </Button>
              </Group>
            </Group>
          </Alert>
        )}
        {!app ? (
          <WorkspaceAppList
            apps={apps}
            editable={editable}
            ready={ready}
            openSettings={openSettings}
            openApp={openApp}
            download={download}
          />
        ) : (
          <>
            <div>
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                leftSection={<ArrowLeft size={14} />}
                px={0}
                mb="lg"
                onClick={() => select(null)}
              >
                全部应用
              </Button>
              <Group justify="space-between">
                <Group gap="md">
                  <Avatar
                    size={54}
                    radius="lg"
                    color="blue"
                    src={app.platformIcons?.[platform]}
                    alt={`${app.name} ${platform === "apple" ? "App Store" : "Google Play"} 图标`}
                  >
                    {app.name.slice(0, 1).toUpperCase()}
                  </Avatar>
                  <div>
                    <Title order={1} size={27}>
                      {app.name}
                    </Title>
                    <Text size="xs" c="dimmed" mt={5}>
                      {app[platform] || "此平台未启用"}
                    </Text>
                  </div>
                </Group>
                <Group>
                  <Text size="xs" c={saved ? "green.8" : "dimmed"}>
                    {saved ? "✓ 已保存" : "保存中…"}
                  </Text>
                  <Button
                    variant="default"
                    leftSection={<Settings2 size={15} />}
                    onClick={() => openSettings(app)}
                    disabled={!editable}
                  >
                    应用设置
                  </Button>
                </Group>
              </Group>
            </div>
            <Group justify="space-between" gap="md">
              <Group>
                <Button.Group>
                  {(["apple", "google"] as Platform[]).map((p) => (
                    <Button
                      key={p}
                      variant={platform === p ? "filled" : "default"}
                      onClick={() => {
                        setPlatform(p);
                        setLocale(draftLocales(app, p)[0] ?? "en-US");
                      }}
                    >
                      {p === "apple" ? "App Store" : "Google Play"}
                    </Button>
                  ))}
                </Button.Group>
                <Button
                  component={WorkspaceLink}
                  href={`/settings?appId=${app.id}`}
                  variant="subtle"
                  size="xs"
                  color={connectionConfigured ? "green" : "gray"}
                >
                  {connectionConfigured
                    ? connection?.verified
                      ? "连接已验证"
                      : "已配置连接"
                    : "配置商店连接"}
                  <ArrowRight size={12} style={{ marginLeft: 6 }} />
                </Button>
              </Group>
              {app[platform] && (
                <Group gap="xs">
                  <Button
                    variant="default"
                    disabled={!editable || !saved || locales.length < 2}
                    onClick={() => setLanguageModal("update")}
                  >
                    翻译到其他语言
                  </Button>
                  <StoreSyncPanel
                    key={app.id + platform}
                    platform={platform}
                    app={app}
                    locale={locale}
                    onPrimary={setPrimaryLocale}
                    onCatalog={setCatalog}
                    enabled={saved && !blocked && !!connectionConfigured}
                    onImport={(snapshot, section, languages) =>
                      persist((current) =>
                        current.map((a) =>
                          a.id === app.id
                            ? {
                                ...a,
                                drafts: overwriteStoreDrafts(
                                  a.drafts,
                                  snapshot,
                                  platform,
                                  section,
                                  languages,
                                ),
                              }
                            : a,
                        ),
                      )
                    }
                  />
                </Group>
              )}
            </Group>
            {app[platform] ? (
              <div className="locale-workspace">
                <Paper
                  component="aside"
                  aria-label="语言管理"
                  p="sm"
                  className="locale-rail"
                >
                  <Group justify="space-between" mb="xs">
                    <Text fw={600} size="sm">
                      语言 · {locales.length}
                    </Text>
                    <Group gap={4}>
                      <ActionIcon
                        variant="subtle"
                        aria-label="添加语言"
                        title={
                          candidates.length
                            ? "添加语言"
                            : "已添加全部支持的语言"
                        }
                        disabled={!editable || !candidates.length}
                        onClick={() => {
                          setLanguageModal("add");
                        }}
                      >
                        <Plus size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label="删除当前语言"
                        title={
                          protectedLocale
                            ? "商店主语言不可删除"
                            : "删除当前语言"
                        }
                        disabled={
                          !editable ||
                          !primaryLoaded ||
                          protectedLocale ||
                          locales.length < 2
                        }
                        onClick={() => setDeleteLanguage(true)}
                      >
                        <Trash2 size={15} />
                      </ActionIcon>
                    </Group>
                  </Group>
                  <div className="locale-list">
                    {locales.map((code) => (
                      <Button
                        key={code}
                        variant={locale === code ? "light" : "subtle"}
                        color={locale === code ? "blue" : "gray"}
                        justify="space-between"
                        rightSection={
                          isPrimaryLocale(code, primaryLocale) ? (
                            <Badge size="xs" variant="light">
                              主语言
                            </Badge>
                          ) : undefined
                        }
                        aria-pressed={locale === code}
                        onClick={() => setLocale(code)}
                      >
                        {code}
                      </Button>
                    ))}
                  </div>
                </Paper>
                <Stack gap="xl" miw={0}>
                  <ScreenshotList
                    key={`${app.id}:${draftKey}`}
                    appId={app.id}
                    platform={platform}
                    locale={locale}
                    draft={draft}
                    catalog={catalog}
                    enabled={saved && !blocked}
                    updateDraft={update}
                  />
                  {platform === "google" && (
                    <StoreGraphicsEditor
                      appId={app.id}
                      locale={locale}
                      key={app.id + draftKey}
                      draft={draft}
                      enabled={editable && !!app.drafts[draftKey]}
                      updateDraft={update}
                    />
                  )}
                  <StoreCopyEditor
                    locale={locale}
                    draft={draft}
                    editable={editable}
                    platform={platform}
                    update={update}
                  >
                    <Group
                      justify="space-between"
                      mt="xl"
                      pt="lg"
                      style={{
                        borderTop:
                          "1px solid var(--mantine-color-default-border)",
                      }}
                    >
                      <Text size="xs" c="dimmed">
                        更改自动保存为草稿
                      </Text>
                      <Group>
                        <Button
                          variant="default"
                          disabled={!saved || blocked}
                          loading={validating}
                          onClick={() => void validate()}
                        >
                          校验草稿
                        </Button>
                        <StorePushButton
                          key={app.id + platform + locale}
                          app={app}
                          platform={platform}
                          locale={locale}
                          revision={revision}
                          enabled={saved && !blocked && !!connectionConfigured}
                        />
                      </Group>
                    </Group>
                  </StoreCopyEditor>
                </Stack>
              </div>
            ) : (
              <Paper p="xl">
                <Text c="dimmed">
                  此平台尚未启用。请在应用设置中填写对应的应用标识。
                </Text>
              </Paper>
            )}
          </>
        )}
      </Stack>
      {modal && (
        <AppSettingsDialog
          app={apps.find((value) => value.id === editing)}
          editable={editable}
          onClose={() => setModal(false)}
          onSave={create}
        />
      )}
      {languageModal && app && (
        <TranslationDialog
          key={app.id + platform + languageModal}
          mode={languageModal}
          app={app}
          platform={platform}
          locale={locale}
          primary={primaryLocale}
          revision={revision}
          enabled={editable && saved}
          close={() => setLanguageModal(null)}
          addBlank={addLanguages}
        />
      )}
      <Modal
        opened={deleteLanguage}
        onClose={() => setDeleteLanguage(false)}
        title="删除语言"
        size="sm"
      >
        <Text size="sm">
          删除 {locale} 的草稿及截图引用？其他语言不受影响。
        </Text>
        <Group justify="end" mt="xl">
          <Button variant="default" onClick={() => setDeleteLanguage(false)}>
            取消
          </Button>
          <Button
            color="red"
            disabled={!primaryLoaded || protectedLocale || locales.length < 2}
            onClick={() => {
              if (
                !app ||
                !primaryLoaded ||
                protectedLocale ||
                locales.length < 2
              )
                return;
              persist((current) =>
                current.map((a) => {
                  if (a.id !== app.id) return a;
                  const drafts = { ...a.drafts };
                  delete drafts[draftKey];
                  return { ...a, drafts };
                }),
              );
              setLocale(locales.find((value) => value !== locale)!);
              setDeleteLanguage(false);
            }}
          >
            删除语言
          </Button>
        </Group>
      </Modal>
    </>
  );
}
