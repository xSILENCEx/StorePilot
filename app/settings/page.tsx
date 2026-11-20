"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  FileButton,
  Group,
  Loader,
  Modal,
  NativeSelect,
  NumberInput,
  Paper,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  Check,
  ChevronRight,
  KeyRound,
  Settings2,
  Sparkles,
} from "lucide-react";
import { WorkspaceShell } from "../../components/workspace-shell";
import type { ConfigScope } from "../../lib/config-model";
type Verification = {
  status: string;
  message: string;
  checkedAt?: string;
  jobId?: string;
  steps?: { step: string; message: string }[];
};
type App = { id: string; name: string; apple: string; google: string };
type Field = {
  key: string;
  label: string;
  hint?: string;
  type?: "number";
  options?: string[];
};
const definitions: Record<
  ConfigScope,
  {
    title: string;
    fields: Field[];
    secret: string;
    file?: string;
    defaults: Record<string, string | number>;
  }
> = {
  apple: {
    title: "Apple App Store Connect",
    fields: [
      { key: "issuerId", label: "Issuer ID" },
      { key: "keyId", label: "Key ID" },
      {
        key: "appId",
        label: "Apple 数字应用 ID",
        hint: "App Store Connect 中的 Apple ID，不是 Bundle ID",
      },
      { key: "bundleId", label: "Bundle ID" },
      {
        key: "appPlatform",
        label: "应用平台",
        options: ["IOS", "MAC_OS", "TV_OS", "VISION_OS"],
      },
      {
        key: "version",
        label: "目标版本（可留空）",
        hint: "留空自动读取已上架版本；没有已上架版本时读取最新版本",
      },
    ],
    secret: "App Store Connect API 私钥（.p8）",
    file: ".p8",
    defaults: {
      issuerId: "",
      keyId: "",
      appId: "",
      bundleId: "",
      appPlatform: "IOS",
      version: "",
    },
  },
  google: {
    title: "Google Play",
    fields: [{ key: "packageName", label: "应用包名" }],
    secret: "Google 服务账号 JSON",
    file: ".json",
    defaults: { packageName: "" },
  },
  text: {
    title: "文本模型",
    fields: [
      {
        key: "baseUrl",
        label: "API Base URL",
        hint: "填写 OpenAI 兼容 API 的基础地址（通常以 /v1 结尾），不包含 /chat/completions",
      },
      { key: "model", label: "模型 ID" },
      { key: "timeoutSeconds", label: "超时（秒，10–600）", type: "number" },
    ],
    secret: "文本模型 API Key",
    defaults: { baseUrl: "", model: "", timeoutSeconds: 120 },
  },
  image: {
    title: "图像模型",
    fields: [
      {
        key: "baseUrl",
        label: "API Base URL",
        hint: "填写 OpenAI 兼容 API 基础地址，不包含 /images/generations",
      },
      { key: "model", label: "模型 ID" },
      { key: "timeoutSeconds", label: "超时（秒，10–600）", type: "number" },
    ],
    secret: "图像模型 API Key",
    defaults: { baseUrl: "", model: "", timeoutSeconds: 300 },
  },
};
function ConfigForm({
  scope,
  app,
  onDirty,
  onSaved,
}: {
  scope: ConfigScope;
  app?: App;
  onDirty: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const def = definitions[scope];
  const endpoint = `/api/settings/${scope}${app ? `?appId=${encodeURIComponent(app.id)}` : ""}`;
  const defaults = {
    ...def.defaults,
    ...(scope === "apple"
      ? { bundleId: app?.apple ?? "" }
      : scope === "google"
        ? { packageName: app?.google ?? "" }
        : {}),
  };
  const [fields, setFields] =
    useState<Record<string, string | number>>(defaults);
  const [secret, setSecret] = useState("");
  const [revision, setRevision] = useState(0);
  const [savedSecret, setSavedSecret] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [encryption, setEncryption] = useState(true);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [confirmGoogle, setConfirmGoogle] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const verifying =
    verification?.status === "queued" || verification?.status === "running";
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  async function load() {
    setReady(false);
    setMessage("");
    try {
      const r = await fetch(endpoint, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setFields({ ...defaults, ...data.fields });
      setRevision(data.revision);
      setSavedSecret(data.secretSaved);
      setEncryption(data.encryptionReady);
      setVerification(data.verification);
      setSecret("");
      setDirty(false);
      setReady(true);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "读取失败");
    }
  }
  useEffect(() => {
    void load();
  }, [endpoint]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!verifying) return;
    let active = true;
    const timer = setInterval(() => {
      void fetch(endpoint, { cache: "no-store" })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error);
          if (!active) return;
          if (data.revision !== revision) {
            setVerification(null);
            setMessage("配置已被其他窗口修改，请关闭并重新打开配置。");
            return;
          }
          setVerification(data.verification);
          if (!["queued", "running"].includes(data.verification?.status ?? ""))
            onSaved();
        })
        .catch(() => {
          if (active) setMessage("暂时无法读取验证状态，稍后自动重试。");
        });
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [endpoint, verifying, revision, onSaved]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision,
          fields,
          ...(secret ? { secret } : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setRevision(data.revision);
      setSavedSecret(data.secretSaved);
      setSecret("");
      setDirty(false);
      setVerification(data.verification);
      onSaved();
      notifications.show({
        title: "配置已保存",
        message: "可以继续验证连接。",
        icon: <Check size={16} />,
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  async function verify(verifyApplication = false) {
    setBusy(true);
    setMessage("");
    setConfirmGoogle(false);
    try {
      const url = `/api/settings/${scope}/verify${app ? `?appId=${encodeURIComponent(app.id)}` : ""}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision, verifyApplication }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setVerification({
        status: "queued",
        message: "验证任务已入队",
        jobId: data.id,
      });
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "验证失败");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setConfirmDelete(false);
    setMessage("");
    try {
      const r = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      await load();
      onSaved();
      notifications.show({ message: "配置已清除" });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "清除失败");
    } finally {
      setBusy(false);
    }
  }
  function change(key: string, value: string | number) {
    setFields((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }
  return (
    <form onSubmit={save} autoComplete="off">
      <Stack gap="lg">
        <Text size="sm" c="dimmed">
          {scope === "text" || scope === "image"
            ? "工作空间共享。使用 OpenAI 兼容 API，密钥加密保存在本机。"
            : "当前应用独立配置。密钥加密保存，不通过读取接口回显。"}
        </Text>
        {message && <Alert color="orange">{message}</Alert>}
        {!encryption && (
          <Alert color="red">
            加密主密钥未就绪，请运行 npm run config:key 并重启服务。
          </Alert>
        )}
        {!ready && !message ? (
          <Loader size="sm" />
        ) : (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              {def.fields.map((f) =>
                f.options ? (
                  <NativeSelect
                    key={f.key}
                    label={f.label}
                    description={f.hint}
                    data={f.options}
                    value={fields[f.key] ?? ""}
                    disabled={!ready || busy}
                    onChange={(e) => change(f.key, e.currentTarget.value)}
                  />
                ) : f.type === "number" ? (
                  <NumberInput
                    key={f.key}
                    label={f.label}
                    description={f.hint}
                    min={10}
                    max={600}
                    allowDecimal={false}
                    value={fields[f.key] ?? ""}
                    disabled={!ready || busy}
                    onChange={(value) => change(f.key, value)}
                  />
                ) : (
                  <TextInput
                    key={f.key}
                    label={f.label}
                    description={f.hint}
                    required={f.key !== "version"}
                    value={fields[f.key] ?? ""}
                    disabled={!ready || busy}
                    onChange={(e) => change(f.key, e.currentTarget.value)}
                  />
                ),
              )}
            </SimpleGrid>
            {def.file ? (
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm" fw={550}>
                    {def.secret}
                  </Text>
                  <FileButton
                    accept={def.file}
                    onChange={async (file) => {
                      if (!file) return;
                      if (file.size > 65536) {
                        setMessage("凭据文件不能超过 64 KB");
                        return;
                      }
                      try {
                        setSecret(await file.text());
                        setDirty(true);
                      } catch {
                        setMessage("文件读取失败");
                      }
                    }}
                  >
                    {(props) => (
                      <Button
                        {...props}
                        size="xs"
                        variant="default"
                        disabled={!ready || busy}
                      >
                        上传凭据文件
                      </Button>
                    )}
                  </FileButton>
                </Group>
                <Textarea
                  aria-label={def.secret}
                  description={
                    savedSecret
                      ? "已保存，留空保留原凭据"
                      : "可上传文件或粘贴凭据"
                  }
                  rows={4}
                  value={secret}
                  spellCheck={false}
                  disabled={!ready || busy}
                  onChange={(e) => {
                    setSecret(e.currentTarget.value);
                    setDirty(true);
                  }}
                />
              </Stack>
            ) : (
              <PasswordInput
                label={def.secret}
                description={
                  savedSecret
                    ? "已保存，留空保留原密钥"
                    : "首次保存需填写 API Key"
                }
                autoComplete="new-password"
                value={secret}
                disabled={!ready || busy}
                onChange={(e) => {
                  setSecret(e.currentTarget.value);
                  setDirty(true);
                }}
              />
            )}
          </>
        )}
        {verification && (
          <Alert
            color={
              verification.status === "passed"
                ? "green"
                : verification.status === "failed" ||
                    verification.status === "uncertain"
                  ? "orange"
                  : "blue"
            }
            title={verification.message}
          >
            {verification.checkedAt && (
              <Text size="xs">
                {new Date(verification.checkedAt).toLocaleString()}
              </Text>
            )}
            {verifying && (
              <Text size="xs">后台验证中，可以关闭弹窗后再查看。</Text>
            )}
            {!!verification.steps?.length && (
              <Accordion variant="default">
                <Accordion.Item value="details">
                  <Accordion.Control>查看验证详情</Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      {verification.steps.map((step, i) => (
                        <Text size="xs" key={i}>
                          {step.message}
                        </Text>
                      ))}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            )}
          </Alert>
        )}
        {confirmGoogle && (
          <Alert color="orange" title="确认 Google 应用权限验证">
            <Text size="sm">
              这会创建并删除临时 edit，可能使该账号已有的未提交 edit
              失效。请确认没有其他 API 编辑任务。
            </Text>
            <Group mt="md">
              <Button
                size="xs"
                color="orange"
                onClick={() => void verify(true)}
              >
                确认验证
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={() => setConfirmGoogle(false)}
              >
                取消
              </Button>
            </Group>
          </Alert>
        )}
        {confirmDelete && (
          <Alert color="red" title="清除全部配置及密钥？">
            <Text size="sm">清除后需要重新填写连接信息。</Text>
            <Group mt="md">
              <Button size="xs" color="red" onClick={() => void remove()}>
                确认清除
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </Button>
            </Group>
          </Alert>
        )}
        <Group justify="space-between" className="modal-footer">
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            disabled={!savedSecret || !ready || busy}
            onClick={() => setConfirmDelete(true)}
          >
            清除配置
          </Button>
          <Group gap="xs">
            <Button
              variant="default"
              loading={verifying}
              disabled={!savedSecret || !ready || busy || dirty || verifying}
              onClick={() => void verify()}
            >
              {scope === "google" ? "验证鉴权" : "验证连接"}
            </Button>
            <Button
              type="submit"
              loading={busy}
              disabled={!ready || !encryption}
            >
              保存配置
            </Button>
          </Group>
        </Group>
        {scope === "google" && (
          <Button
            variant="subtle"
            size="xs"
            disabled={!savedSecret || !ready || busy || dirty || verifying}
            onClick={() => setConfirmGoogle(true)}
          >
            验证 Google 应用权限
          </Button>
        )}
        <Text size="xs" c="dimmed">
          {scope === "text" || scope === "image"
            ? "连接验证只检查鉴权与模型目录，不调用生成接口。"
            : "验证不上传资料，也不提交审核或发布版本。"}
        </Text>
      </Stack>
    </form>
  );
}
type Summary = {
  configured: boolean;
  fields: Record<string, unknown>;
  verification: Verification | null;
};
function ConnectionCard({ scope, app }: { scope: ConfigScope; app?: App }) {
  const [state, setState] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [version, setVersion] = useState(0);
  const endpoint = `/api/settings/${scope}${app ? `?appId=${encodeURIComponent(app.id)}` : ""}`;
  const refreshing = ["queued", "running"].includes(
    state?.verification?.status ?? "",
  );
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const r = await fetch(endpoint, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (!controller.signal.aborted) {
          setState(data);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "读取失败");
      }
    };
    void load();
    const timer = refreshing ? setInterval(() => void load(), 2000) : undefined;
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [endpoint, version, refreshing]);
  const reload = useCallback(() => setVersion((current) => current + 1), []);
  const def = definitions[scope];
  const isModel = scope === "text" || scope === "image";
  const status = state?.verification?.status;
  return (
    <>
      <Paper p="xl">
        <Stack gap="lg">
          <Group justify="space-between">
            <ThemeIcon
              variant="light"
              color={isModel ? "blue" : "gray"}
              size={42}
              radius="md"
            >
              {isModel ? <Sparkles size={21} /> : <KeyRound size={21} />}
            </ThemeIcon>
            <Badge
              color={
                !state?.configured
                  ? "gray"
                  : status === "passed"
                    ? "green"
                    : status === "failed" || status === "uncertain"
                      ? "orange"
                      : "blue"
              }
              variant="light"
            >
              {!state
                ? error
                  ? "读取失败"
                  : "读取中"
                : !state.configured
                  ? "未配置"
                  : status === "passed"
                    ? "连接正常"
                    : status === "partial"
                      ? "部分验证通过"
                      : status === "failed"
                        ? "验证失败"
                        : status === "uncertain"
                          ? "结果未知"
                          : status === "queued" || status === "running"
                            ? "验证中"
                            : "已配置"}
            </Badge>
          </Group>
          <div>
            <Title order={3} size="h4">
              {def.title}
            </Title>
            <Text size="sm" c="dimmed" mt={7} lineClamp={1}>
              {error ||
                String(
                  isModel
                    ? state?.fields.model || "连接你的模型服务"
                    : scope === "apple"
                      ? state?.fields.bundleId ||
                        app?.apple ||
                        "填写 App Store Connect 凭据"
                      : state?.fields.packageName ||
                        app?.google ||
                        "填写 Google Play 服务账号",
                )}
            </Text>
          </div>
          <Button
            variant="default"
            rightSection={<ChevronRight size={15} />}
            justify="space-between"
            onClick={() => {
              setDiscard(false);
              setOpened(true);
            }}
          >
            管理配置
          </Button>
        </Stack>
      </Paper>
      <Modal
        opened={opened}
        onClose={() => {
          if (dirty) setDiscard(true);
          else setOpened(false);
        }}
        closeOnClickOutside={false}
        title={def.title}
        size="700px"
      >
        {discard && (
          <Alert color="orange" title="有未保存的修改" mb="lg">
            <Text size="sm">继续编辑，或丢弃修改后关闭。</Text>
            <Group mt="sm">
              <Button
                size="xs"
                variant="default"
                onClick={() => setDiscard(false)}
              >
                继续编辑
              </Button>
              <Button
                size="xs"
                color="orange"
                onClick={() => {
                  setOpened(false);
                  setDirty(false);
                  setDiscard(false);
                }}
              >
                丢弃并关闭
              </Button>
            </Group>
          </Alert>
        )}
        {opened && (
          <ConfigForm
            key={`${scope}:${app?.id ?? "global"}`}
            scope={scope}
            app={app}
            onDirty={setDirty}
            onSaved={reload}
          />
        )}
      </Modal>
    </>
  );
}
export default function Settings() {
  const [apps, setApps] = useState<App[]>([]);
  const [selected, setSelected] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/apps", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          location.href = "/login";
          return;
        }
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setApps(data.apps);
        const requested = new URLSearchParams(location.search).get("appId");
        setSelected(
          data.apps.some((a: App) => a.id === requested)
            ? requested
            : (data.apps[0]?.id ?? ""),
        );
        setReady(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  const app = apps.find((a) => a.id === selected);
  return (
    <WorkspaceShell active="settings" title="连接与模型">
      <Stack gap="xl">
        <div className="page-heading">
          <Text className="eyebrow" mb={10}>
            CONNECTIONS & MODELS
          </Text>
          <Title order={1} size={30}>
            连接与模型
          </Title>
          <Text size="sm" c="dimmed" mt="xs">
            一次配置，连接商店与 AI。凭据加密保存在本机。
          </Text>
        </div>
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="space-between">
          <Title order={2} size="h4">
            商店连接
          </Title>
          {!!apps.length && (
            <Select
              size="sm"
              aria-label="选择应用"
              value={selected}
              onChange={(value) => value && setSelected(value)}
              data={apps.map((a) => ({ value: a.id, label: a.name }))}
              w={220}
            />
          )}
        </Group>
        {!ready && !error ? (
          <Loader size="sm" />
        ) : app ? (
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <ConnectionCard key={`apple:${app.id}`} scope="apple" app={app} />
            <ConnectionCard key={`google:${app.id}`} scope="google" app={app} />
          </SimpleGrid>
        ) : (
          <Paper p="xl">
            <Text size="sm" c="dimmed">
              先在工作台添加应用，再配置商店连接。
            </Text>
            <Button component="a" href="/" variant="light" mt="md">
              返回应用管理
            </Button>
          </Paper>
        )}
        <div>
          <Title order={2} size="h4">
            AI 模型
          </Title>
          <Text size="xs" c="dimmed" mt={6}>
            工作空间共享，文本与图像服务可独立选择。
          </Text>
        </div>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <ConnectionCard scope="text" />
          <ConnectionCard scope="image" />
        </SimpleGrid>
      </Stack>
    </WorkspaceShell>
  );
}
