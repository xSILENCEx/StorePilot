"use client";
import { useEffect, useState } from "react";
import {
  Accordion,
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Layers,
  Plus,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { useWorkspaceNavigation } from "../../components/workspace-shell";
import type { DeviceGroup } from "../../lib/screenshot-groups";
import { availableStoreLocales } from "../../lib/store-locales";
import { StoreGraphicsEditor } from "../../components/store-graphics-editor";
import { ScreenshotList } from "../../components/screenshot-list";
import { StoreSyncPanel } from "../../components/store-sync-panel";
import { importMissing } from "../../lib/apple-sync-model";
import { useWorkspace } from "../../lib/use-workspace";
import type { Draft, Platform, StoreApp } from "../../lib/model";
const empty = (): Draft => ({
  title: "",
  subtitle: "",
  description: "",
  keywords: "",
  images: [],
});
export default function Home() {
  const [message, setMessage] = useState("");
  const { apps, ready, saved, blocked, persist, retry } =
    useWorkspace(setMessage);
  const [selected, select] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>("apple");
  const [catalog, setCatalog] = useState<DeviceGroup[]>();
  const [locale, setLocale] = useState("en-US");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [apple, setApple] = useState("");
  const [google, setGoogle] = useState("");
  const [languageModal, setLanguageModal] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const [deleteLanguage, setDeleteLanguage] = useState(false);
  const [validating, setValidating] = useState(false);
  const [connection, setConnection] = useState<{
    appId: string;
    platform: string;
    configured: boolean;
    verified: boolean;
  } | null>(null);
  const app = apps.find((a) => a.id === selected);
  const draftKey = `${platform}:${locale}`;
  const draft = app?.drafts[draftKey] ?? empty();
  const locales = app
    ? Object.keys(app.drafts)
        .filter((key) => key.startsWith(`${platform}:`))
        .map((key) => key.slice(platform.length + 1))
    : [];
  const candidates = availableStoreLocales(platform, locales);
  const matchingLanguages = candidates.filter(({ name, code }) =>
    (name + " " + code)
      .toLowerCase()
      .includes(languageSearch.trim().toLowerCase()),
  );
  const editable = ready && !blocked;
  const connectionConfigured =
    connection?.appId === selected &&
    connection.platform === platform &&
    connection.configured;
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void fetch(`/api/settings/${platform}?appId=${selected}`, {
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
    setLocale(
      Object.keys(value.drafts)
        .find((key) => key.startsWith(`${p}:`))
        ?.slice(p.length + 1) ?? "en-US",
    );
  }
  function openSettings(value?: StoreApp) {
    setEditing(value?.id ?? null);
    setName(value?.name ?? "");
    setApple(value?.apple ?? "");
    setGoogle(value?.google ?? "");
    setModal(true);
  }
  function create(e: React.FormEvent) {
    e.preventDefault();
    const id = editing ?? crypto.randomUUID();
    const existing = apps.find((a) => a.id === editing);
    const next = {
      id,
      name: name.trim(),
      apple: apple.trim(),
      google: google.trim(),
      drafts: {
        ...(apple.trim() ? { "apple:en-US": empty() } : {}),
        ...(google.trim() ? { "google:en-US": empty() } : {}),
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
  function addLanguage(code: string) {
    if (!app || !editable || !candidates.some((option) => option.code === code))
      return;
    const key = `${platform}:${code}`;
    const added = persist((current) =>
      current.map((a) =>
        a.id === app.id && !a.drafts[key]
          ? { ...a, drafts: { ...a.drafts, [key]: empty() } }
          : a,
      ),
    );
    if (added) {
      setLocale(code);
      setLanguageModal(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(apps, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "storepilot-drafts.json";
    link.click();
    URL.revokeObjectURL(url);
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
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
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
  const filtered = apps.filter((a) =>
    `${a.name} ${a.apple} ${a.google}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  useWorkspaceNavigation(app?.name, app?.id, saved && !blocked);
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
          <>
            <Group justify="space-between" className="page-heading">
              <div>
                <Text className="eyebrow" mb={10}>
                  YOUR STORE WORKSPACE
                </Text>
                <Title order={1} size={30}>
                  应用管理
                </Title>
                <Text c="dimmed" size="sm" mt="xs">
                  在一个地方，准备每个平台、每种语言的商店资料。
                </Text>
              </div>
              <Button
                leftSection={<Plus size={17} />}
                onClick={() => openSettings()}
                disabled={!editable}
              >
                添加应用
              </Button>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                全部应用{" "}
                <Text component="span" c="dark" fw={600} ml={6}>
                  {apps.length}
                </Text>
              </Text>
              <Group>
                <TextInput
                  size="sm"
                  placeholder="搜索应用"
                  aria-label="搜索应用"
                  leftSection={<Search size={15} />}
                  value={search}
                  onChange={(e) => setSearch(e.currentTarget.value)}
                />
                <Tooltip label="导出草稿 JSON">
                  <ActionIcon
                    variant="default"
                    size="lg"
                    aria-label="导出草稿"
                    onClick={download}
                  >
                    <Download size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
            {!ready ? (
              <Center py={80}>
                <Loader size="sm" />
              </Center>
            ) : !apps.length ? (
              <Paper p={60}>
                <Stack align="center" gap="md">
                  <Avatar size={68} radius="xl" color="blue">
                    <Layers size={29} />
                  </Avatar>
                  <Title order={3}>从第一个应用开始</Title>
                  <Text c="dimmed" size="sm" ta="center">
                    整理文案、生成截图，为下一次版本更新做好准备。
                  </Text>
                  <Button
                    leftSection={<Plus size={16} />}
                    onClick={() => openSettings()}
                    disabled={!editable}
                  >
                    添加第一个应用
                  </Button>
                </Stack>
              </Paper>
            ) : !filtered.length ? (
              <Text c="dimmed" ta="center" py="xl">
                没有找到匹配的应用
              </Text>
            ) : (
              <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="lg">
                {filtered.map((a) => (
                  <Paper key={a.id} p="xl" className="app-card">
                    <UnstyledButton onClick={() => openApp(a)} w="100%">
                      <Stack gap="lg">
                        <Group justify="space-between">
                          <Avatar size={52} radius="lg" color="blue">
                            {a.name.slice(0, 1).toUpperCase()}
                          </Avatar>
                          <ArrowRight
                            size={18}
                            color="var(--mantine-color-dimmed)"
                          />
                        </Group>
                        <div>
                          <Title order={3} size="h4">
                            {a.name}
                          </Title>
                          <Text size="xs" c="dimmed" mt={6} lineClamp={1}>
                            {a.apple || a.google}
                          </Text>
                        </div>
                        <Group gap="xs">
                          {a.apple && (
                            <Badge color="gray" variant="light">
                              App Store
                            </Badge>
                          )}
                          {a.google && (
                            <Badge color="gray" variant="light">
                              Google Play
                            </Badge>
                          )}
                        </Group>
                      </Stack>
                    </UnstyledButton>
                  </Paper>
                ))}
              </SimpleGrid>
            )}
          </>
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
                  <Avatar size={54} radius="lg" color="blue">
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
                        setLocale(
                          Object.keys(app.drafts)
                            .find((key) => key.startsWith(`${p}:`))
                            ?.slice(p.length + 1) ?? "en-US",
                        );
                      }}
                    >
                      {p === "apple" ? "App Store" : "Google Play"}
                    </Button>
                  ))}
                </Button.Group>
                <Button
                  component="a"
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
                <StoreSyncPanel
                  key={app.id + platform}
                  platform={platform}
                  app={app}
                  locale={locale}
                  onCatalog={setCatalog}
                  onImportGraphic={(targetLocale, remoteDraft, type, url) => {
                    const key = `google:${targetLocale}`;
                    const ok = persist((current) =>
                      current.map((a) => {
                        if (a.id !== app.id) return a;
                        const draft = a.drafts[key] ?? remoteDraft;
                        return {
                          ...a,
                          drafts: {
                            ...a.drafts,
                            [key]: {
                              ...draft,
                              graphics: { ...draft.graphics, [type]: url },
                            },
                          },
                        };
                      }),
                    );
                    if (ok) setLocale(targetLocale);
                    return ok;
                  }}
                  onImportLocale={(targetLocale, remoteDraft) => {
                    const key = `${platform}:${targetLocale}`;
                    const result = persist((current) =>
                      current.map((a) =>
                        a.id === app.id
                          ? {
                              ...a,
                              drafts: {
                                ...a.drafts,
                                [key]: {
                                  ...a.drafts[key],
                                  ...remoteDraft,
                                  keywords:
                                    platform === "google"
                                      ? (a.drafts[key]?.keywords ?? "")
                                      : remoteDraft.keywords,
                                  images: a.drafts[key]?.images ?? [],
                                  screenshotGroups:
                                    a.drafts[key]?.screenshotGroups,
                                },
                              },
                            }
                          : a,
                      ),
                    );
                    if (result) setLocale(targetLocale);
                    return result;
                  }}
                  onImportScreenshots={(targetLocale, remoteDraft, shots) => {
                    const key = `${platform}:${targetLocale}`;
                    const device = shots[0]?.deviceType;
                    if (!device) return false;
                    const currentImages =
                      app.drafts[key]?.screenshotGroups?.[device] ?? [];
                    const limit =
                      platform === "google"
                        ? 8
                        : (catalog?.find((g) => g.value === device)?.limit ??
                          10);
                    const urls = shots.flatMap((image) =>
                      image.url ? [image.url] : [],
                    );
                    if (new Set([...currentImages, ...urls]).size > limit) {
                      notifications.show({
                        color: "orange",
                        message: `导入后超过此设备组的 ${limit} 张上限。`,
                      });
                      return false;
                    }
                    const result = persist((current) =>
                      current.map((a) =>
                        a.id === app.id
                          ? {
                              ...a,
                              drafts: {
                                ...a.drafts,
                                [key]: {
                                  ...(a.drafts[key] ?? remoteDraft),
                                  screenshotGroups: {
                                    ...a.drafts[key]?.screenshotGroups,
                                    [device]: [
                                      ...new Set([
                                        ...(a.drafts[key]?.screenshotGroups?.[
                                          device
                                        ] ?? []),
                                        ...urls,
                                      ]),
                                    ],
                                  },
                                },
                              },
                            }
                          : a,
                      ),
                    );
                    if (result) setLocale(targetLocale);
                    return result;
                  }}
                  enabled={saved && !blocked && !!connectionConfigured}
                  onImport={(snapshot) =>
                    persist((current) =>
                      current.map((a) =>
                        a.id === app.id
                          ? {
                              ...a,
                              drafts: importMissing(
                                a.drafts,
                                snapshot,
                                platform,
                              ),
                            }
                          : a,
                      ),
                    )
                  }
                />
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
                          setLanguageSearch("");
                          setLanguageModal(true);
                        }}
                      >
                        <Plus size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label="删除当前语言"
                        title="删除当前语言"
                        disabled={!editable || locales.length < 2}
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
                        justify="start"
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
                      key={app.id + draftKey}
                      draft={draft}
                      enabled={editable && !!app.drafts[draftKey]}
                      updateDraft={update}
                    />
                  )}
                  <Paper p={{ base: "md", sm: "xl" }}>
                    <Group justify="space-between" mb="xl">
                      <div>
                        <Title order={3} size="h4">
                          商店文案
                        </Title>
                        <Text size="xs" c="dimmed" mt={5}>
                          让用户用自己的语言了解你的应用。
                        </Text>
                      </div>
                      <Badge variant="light" color="gray">
                        {locale}
                      </Badge>
                    </Group>
                    <Stack gap="lg">
                      <SimpleGrid cols={{ base: 1, sm: 2 }}>
                        <TextInput
                          label="应用名称"
                          value={draft.title}
                          disabled={!editable}
                          onChange={(e) =>
                            update({ title: e.currentTarget.value })
                          }
                          placeholder="输入应用名称"
                        />
                        <TextInput
                          label={platform === "apple" ? "副标题" : "简短描述"}
                          value={draft.subtitle}
                          disabled={!editable}
                          onChange={(e) =>
                            update({ subtitle: e.currentTarget.value })
                          }
                          placeholder="一句话描述应用的价值"
                        />
                      </SimpleGrid>
                      <Textarea
                        label="完整描述"
                        minRows={6}
                        autosize
                        maxRows={16}
                        value={draft.description}
                        disabled={!editable}
                        onChange={(e) =>
                          update({ description: e.currentTarget.value })
                        }
                        placeholder="介绍应用的功能与特色…"
                      />
                      {platform === "google" && (
                        <TextInput
                          label="宣传视频网址"
                          value={draft.video ?? ""}
                          disabled={!editable}
                          onChange={(e) =>
                            update({ video: e.currentTarget.value })
                          }
                        />
                      )}
                      <TextInput
                        label={platform === "apple" ? "关键词" : "内部备注"}
                        description={
                          platform === "apple"
                            ? "用英文逗号分隔关键词"
                            : "仅供内部整理，不上传到 Google Play"
                        }
                        value={draft.keywords}
                        disabled={!editable}
                        onChange={(e) =>
                          update({ keywords: e.currentTarget.value })
                        }
                      />
                    </Stack>
                    {platform === "apple" && (
                      <Accordion mt="lg" variant="default">
                        <Accordion.Item value="more">
                          <Accordion.Control>更多商店元数据</Accordion.Control>
                          <Accordion.Panel>
                            <Stack gap="md">
                              <Textarea
                                label="推广文本"
                                value={draft.promotionalText ?? ""}
                                disabled={!editable}
                                onChange={(e) =>
                                  update({
                                    promotionalText: e.currentTarget.value,
                                  })
                                }
                                minRows={2}
                              />
                              <Textarea
                                label="版本更新说明"
                                value={draft.whatsNew ?? ""}
                                disabled={!editable}
                                onChange={(e) =>
                                  update({ whatsNew: e.currentTarget.value })
                                }
                                minRows={3}
                              />
                              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                                {(
                                  [
                                    "supportUrl",
                                    "marketingUrl",
                                    "privacyPolicyUrl",
                                    "privacyChoicesUrl",
                                  ] as const
                                ).map((field) => (
                                  <TextInput
                                    key={field}
                                    label={
                                      {
                                        supportUrl: "支持网址",
                                        marketingUrl: "营销网址",
                                        privacyPolicyUrl: "隐私政策网址",
                                        privacyChoicesUrl: "隐私选择网址",
                                      }[field]
                                    }
                                    value={draft[field] ?? ""}
                                    disabled={!editable}
                                    onChange={(e) =>
                                      update({ [field]: e.currentTarget.value })
                                    }
                                  />
                                ))}
                              </SimpleGrid>
                            </Stack>
                          </Accordion.Panel>
                        </Accordion.Item>
                      </Accordion>
                    )}
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
                        更改自动保存为本地草稿
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
                        <Tooltip label="商店推送尚未接入">
                          <span>
                            <Button disabled>推送到商店</Button>
                          </span>
                        </Tooltip>
                      </Group>
                    </Group>
                  </Paper>
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
      <Modal
        opened={modal}
        onClose={() => setModal(false)}
        title={editing ? "应用设置" : "添加应用"}
        size="md"
      >
        <form onSubmit={create}>
          <Stack>
            <Text size="sm" c="dimmed">
              填写名称与至少一个平台的应用标识。
            </Text>
            <TextInput
              data-autofocus
              required
              label="应用名称"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="例如：我的应用"
            />
            <TextInput
              label="Apple Bundle ID"
              value={apple}
              onChange={(e) => setApple(e.currentTarget.value)}
              placeholder="com.example.app"
            />
            <TextInput
              label="Google 包名"
              value={google}
              onChange={(e) => setGoogle(e.currentTarget.value)}
              placeholder="com.example.app"
            />
            <Group justify="end" className="modal-footer">
              <Button variant="default" onClick={() => setModal(false)}>
                取消
              </Button>
              <Button
                type="submit"
                disabled={
                  !editable || !name.trim() || (!apple.trim() && !google.trim())
                }
              >
                {editing ? "保存设置" : "创建应用"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
      <Modal
        opened={languageModal}
        onClose={() => setLanguageModal(false)}
        title="添加语言"
        size="sm"
      >
        <Stack gap="sm">
          <TextInput
            data-autofocus
            aria-label="搜索语言"
            placeholder="搜索语言名称或代码"
            value={languageSearch}
            onChange={(event) => setLanguageSearch(event.currentTarget.value)}
            leftSection={<Search size={16} />}
          />
          <Stack gap={2} mah="min(55dvh, 420px)" style={{ overflowY: "auto" }}>
            {matchingLanguages.map(({ name, code }) => (
              <Button
                key={code}
                style={{ flexShrink: 0 }}
                variant="subtle"
                color="gray"
                justify="space-between"
                rightSection={
                  <Text component="span" size="xs" c="dimmed">
                    {code}
                  </Text>
                }
                disabled={!editable}
                onClick={() => addLanguage(code)}
              >
                {name}
              </Button>
            ))}
            {!matchingLanguages.length && (
              <Text size="sm" c="dimmed">
                没有可添加的匹配语言
              </Text>
            )}
          </Stack>
        </Stack>
      </Modal>
      <Modal
        opened={deleteLanguage}
        onClose={() => setDeleteLanguage(false)}
        title="删除语言"
        size="sm"
      >
        <Text size="sm">
          删除 {locale} 的本地草稿及截图引用？其他语言不受影响。
        </Text>
        <Group justify="end" mt="xl">
          <Button variant="default" onClick={() => setDeleteLanguage(false)}>
            取消
          </Button>
          <Button
            color="red"
            onClick={() => {
              if (!app) return;
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
