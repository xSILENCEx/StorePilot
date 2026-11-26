"use client";
import { readApiResponse } from "../lib/api-response";
import { isJobActive } from "../lib/job-status";
import { poll } from "../lib/poll";
import { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Button,
  FileButton,
  Group,
  Loader,
  NativeSelect,
  NumberInput,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Check } from "lucide-react";
import type { ConfigScope } from "../lib/config-model";
import {
  definitions,
  settingsUrl,
  type App,
  type Verification,
} from "./connection-fields";
export function ConfigForm({
  scope,
  app,
  onDirty,
  onSaved,
}: {
  scope: ConfigScope;
  app?: App;
  onDirty: (dirty: boolean) => void;
  onSaved?: () => void;
}) {
  const def = definitions[scope];
  const endpoint = settingsUrl(scope, app?.id);
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
  const verifying = isJobActive(verification?.status);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  async function load() {
    setReady(false);
    setMessage("");
    try {
      const r = await fetch(endpoint, { cache: "no-store" });
      const data = await readApiResponse(r);
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
    return poll(
      async (signal) => {
        try {
          const r = await fetch(endpoint, { cache: "no-store", signal });
          const data = await readApiResponse(r);
          if (signal.aborted) return;
          if (data.revision !== revision) {
            setVerification(null);
            setMessage("配置已被其他窗口修改，请关闭并重新打开配置。");
            return;
          }
          setVerification(data.verification);
          if (!isJobActive(data.verification?.status)) onSaved?.();
        } catch {
          if (!signal.aborted)
            setMessage("暂时无法读取验证状态，稍后自动重试。");
        }
      },
      2000,
      false,
    );
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
      const data = await readApiResponse(r);
      setRevision(data.revision);
      setSavedSecret(data.secretSaved);
      setSecret("");
      setDirty(false);
      setVerification(data.verification);
      onSaved?.();
      if (scope === "text" || scope === "image") {
        setFields({ ...defaults, ...data.fields });
        await verify(false, data.revision);
        return;
      }
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
  async function verify(verifyApplication = false, savedRevision = revision) {
    setBusy(true);
    setMessage("");
    setConfirmGoogle(false);
    try {
      const url = settingsUrl(scope, app?.id, true);
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: savedRevision, verifyApplication }),
      });
      const data = await readApiResponse(r);
      setVerification({
        status: "queued",
        message: "验证任务已入队",
        jobId: data.id,
      });
      onSaved?.();
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
      const data = await readApiResponse(r);
      await load();
      onSaved?.();
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
  function renderField(f: (typeof def.fields)[number]) {
    return f.options ? (
      <NativeSelect
        size="md"
        key={f.key}
        label={f.label}
        description={f.hint}
        inputWrapperOrder={["label", "input", "description", "error"]}
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
        inputWrapperOrder={["label", "input", "description", "error"]}
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
        inputWrapperOrder={["label", "input", "description", "error"]}
        required={f.key !== "version"}
        value={fields[f.key] ?? ""}
        disabled={!ready || busy}
        onChange={(e) => change(f.key, e.currentTarget.value)}
      />
    );
  }
  return (
    <form onSubmit={save} autoComplete="off">
      <Stack gap="lg">
        <Text size="sm" c="dimmed">
          {scope === "text" || scope === "image"
            ? "工作空间共享。使用 OpenAI 兼容 API，密钥加密保存。"
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
            {scope === "apple" ? (
              [
                { title: "应用信息", keys: ["appId", "bundleId"] },
                { title: "同步版本", keys: ["appPlatform", "version"] },
                { title: "API 凭据", keys: ["issuerId", "keyId"] },
              ].map((section) => (
                <Stack gap="xs" key={section.title}>
                  <Text component="h3" size="sm" fw={700} m={0}>
                    {section.title}
                  </Text>
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    {def.fields
                      .filter((f) => section.keys.includes(f.key))
                      .map(renderField)}
                  </SimpleGrid>
                </Stack>
              ))
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {def.fields.map(renderField)}
              </SimpleGrid>
            )}
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
                  rows={scope === "apple" && savedSecret ? 2 : 4}
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
