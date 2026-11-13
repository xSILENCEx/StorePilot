"use client";
import { useEffect, useState } from "react";
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
        hint: "后续同步时选择可编辑版本，不提交审核或发布",
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
      { key: "concurrency", label: "并发上限（1–8）", type: "number" },
    ],
    secret: "文本模型 API Key",
    defaults: { baseUrl: "", model: "", timeoutSeconds: 120, concurrency: 2 },
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
      { key: "concurrency", label: "并发上限（1–8）", type: "number" },
    ],
    secret: "图像模型 API Key",
    defaults: { baseUrl: "", model: "", timeoutSeconds: 300, concurrency: 1 },
  },
};
function ConfigForm({ scope, app }: { scope: ConfigScope; app?: App }) {
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
  const [updated, setUpdated] = useState<string | null>(null);
  const [encryption, setEncryption] = useState(true);
  const [verification, setVerification] = useState<Verification | null>(null);
  const verifying =
    verification?.status === "queued" || verification?.status === "running";
  useEffect(() => {
    if (!verifying) return;
    const timer = setInterval(() => {
      void fetch(endpoint, { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error();
          const data = await r.json();
          if (data.revision !== revision) {
            setVerification(null);
            setMessage("配置已被其他窗口修改，请重新载入");
            return;
          }
          setVerification(data.verification);
        })
        .catch(() =>
          setMessage("暂时无法读取验证状态，稍后自动重试；任务仍在后台运行。"),
        );
    }, 2000);
    return () => clearInterval(timer);
  }, [endpoint, verifying, revision]);
  async function verify(verifyApplication = false) {
    if (
      verifyApplication &&
      !confirm(
        "Google 应用权限验证会创建并删除一个临时 edit，可能使该服务账号已有的未提交 edit 失效。请确认没有正在进行的 Google API 编辑任务。继续验证？",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(
        endpoint.replace("?", "/verify?") +
          (endpoint.includes("?") ? "" : "/verify"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision, verifyApplication }),
        },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setVerification({
        status: "queued",
        message: "验证已入队，等待本机 Worker",
        jobId: data.id,
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "验证请求失败");
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    setReady(false);
    setMessage("");
    try {
      const r = await fetch(endpoint, { cache: "no-store" });
      if (r.status === 401) {
        location.href = "/login";
        return;
      }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setFields({ ...defaults, ...data.fields });
      setRevision(data.revision);
      setSavedSecret(data.secretSaved);
      setUpdated(data.updatedAt);
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
  }, [endpoint]); // 表单按 scope/appId 挂载
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (dirty) e.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
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
      setUpdated(data.updatedAt);
      setSecret("");
      setDirty(false);
      setVerification(data.verification);
      setMessage("配置已保存，请点击验证连接。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`清除${def.title}的全部已保存配置及密钥？`)) return;
    setBusy(true);
    try {
      const r = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      await load();
      setMessage("配置已清除");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "清除失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="config-card" onSubmit={save} autoComplete="off">
      <div className="section-title">
        <h2>{def.title}</h2>
        <span className="badge">
          {!savedSecret
            ? "未配置"
            : dirty
              ? "有未保存修改"
              : verification?.status === "passed"
                ? "连接验证通过"
                : verification?.status === "partial"
                  ? "部分验证通过"
                  : verification?.status === "failed"
                    ? "验证失败"
                    : verifying
                      ? "验证中"
                      : "已填写 · 未验证"}
        </span>
      </div>
      <p>
        {scope === "text" || scope === "image"
          ? "验证 API 鉴权和模型目录；不发送生成请求，生成能力与额度尚未验证。"
          : "验证商店鉴权与应用读取；不会上传资料、提交审核或发布版本。"}
      </p>
      {!encryption && (
        <div className="warning">
          加密主密钥未就绪：请运行 npm run config:key 后重启 Web / Worker。
        </div>
      )}
      {scope === "apple" && (
        <p>
          <a
            className="export"
            href="https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api"
            target="_blank"
            rel="noreferrer"
          >
            Apple API 密钥获取说明 ↗
          </a>
        </p>
      )}
      {scope === "google" && (
        <p>
          <a
            className="export"
            href="https://docs.cloud.google.com/iam/docs/keys-create-delete"
            target="_blank"
            rel="noreferrer"
          >
            Google 服务账号密钥获取说明 ↗
          </a>
        </p>
      )}
      <fieldset disabled={!ready || busy}>
        <div className="fields">
          {def.fields.map((f) => (
            <label key={f.key}>
              <span>{f.label}</span>
              {f.options ? (
                <select
                  value={fields[f.key] ?? ""}
                  onChange={(e) => {
                    setFields({ ...fields, [f.key]: e.target.value });
                    setDirty(true);
                  }}
                >
                  {f.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  required={f.key !== "version"}
                  type={f.type ?? "text"}
                  min={
                    f.key === "concurrency"
                      ? 1
                      : f.type === "number"
                        ? 10
                        : undefined
                  }
                  max={
                    f.key === "concurrency"
                      ? 8
                      : f.type === "number"
                        ? 600
                        : undefined
                  }
                  value={fields[f.key] ?? ""}
                  onChange={(e) => {
                    setFields({
                      ...fields,
                      [f.key]:
                        f.type === "number"
                          ? e.target.value === ""
                            ? ""
                            : Number(e.target.value)
                          : e.target.value,
                    });
                    setDirty(true);
                  }}
                />
              )}
              {f.hint && <small>{f.hint}</small>}
            </label>
          ))}
        </div>
        <label className="secret-field">
          <span>
            {def.secret} {savedSecret && "（已保存，留空保留）"}
          </span>
          {def.file ? (
            <>
              <input
                type="file"
                accept={def.file}
                aria-label={`上传${def.secret}`}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (file.size > 65536) {
                    setMessage("凭据文件不能超过 64 KB");
                    return;
                  }
                  try {
                    setSecret(await file.text());
                    setDirty(true);
                    setMessage("文件已载入，点击保存后生效");
                  } catch {
                    setMessage("文件读取失败");
                  }
                }}
              />
              <textarea
                value={secret}
                rows={4}
                spellCheck={false}
                placeholder={
                  savedSecret
                    ? "输入新凭据以替换，留空保留"
                    : "上传文件或粘贴凭据内容"
                }
                onChange={(e) => {
                  setSecret(e.target.value);
                  setDirty(true);
                }}
              />
            </>
          ) : (
            <input
              type="password"
              autoComplete="new-password"
              value={secret}
              placeholder={savedSecret ? "已保存，留空保留" : "输入 API Key"}
              onChange={(e) => {
                setSecret(e.target.value);
                setDirty(true);
              }}
            />
          )}
          <small>
            密钥加密保存，不通过读取接口回显，也不会包含在草稿导出中。
          </small>
        </label>
      </fieldset>
      {verification && (
        <div className="verification-result" role="status">
          <b>{verification.message}</b>
          {verification.checkedAt && (
            <p>验证时间：{new Date(verification.checkedAt).toLocaleString()}</p>
          )}
          {verification.jobId && <p>任务：{verification.jobId}</p>}
          {verification.steps?.map((item, i) => (
            <p key={i}>
              {item.step}：{item.message}
            </p>
          ))}
          {verifying && (
            <p>
              每 2 秒刷新。关闭页面不影响任务；若长期排队，请检查 npm run worker
              是否正在运行。
            </p>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="config-message">
          {message}
        </p>
      )}
      <div className="config-actions">
        <button
          type="button"
          className="secondary"
          disabled={!savedSecret || !ready || busy || dirty || verifying}
          onClick={() => void verify()}
        >
          {scope === "google" ? "验证鉴权" : "验证连接"}
        </button>
        {scope === "google" && (
          <button
            type="button"
            className="secondary"
            disabled={!savedSecret || !ready || busy || dirty || verifying}
            onClick={() => void verify(true)}
          >
            验证应用权限
          </button>
        )}

        <button className="primary" disabled={!ready || busy || !encryption}>
          {busy ? "处理中…" : "保存配置"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            if (!dirty || confirm("丢弃当前未保存内容并重新载入？"))
              void load();
          }}
        >
          重新载入
        </button>
        <button
          type="button"
          disabled={!savedSecret || busy || !ready}
          onClick={() => void remove()}
        >
          清除配置
        </button>
        <span>
          {dirty
            ? "有未保存修改"
            : updated
              ? `保存于 ${new Date(updated).toLocaleString()}`
              : ""}
        </span>
      </div>
    </form>
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
    <div className="settings-shell">
      <a className="back" href="/">
        ← 返回应用工作台
      </a>
      <div className="heading">
        <div>
          <h1>连接与模型配置</h1>
          <p>
            商店配置按应用、平台独立保存；文本与图像模型为工作空间共享配置。
          </p>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="warning">
        先保存配置，再点击卡片上的验证按钮。结果只覆盖所列检查项；图像生成已在应用详情的
        AI 截图工作室接通；商店同步与推送尚未接通。
      </div>
      <h2>商店连接</h2>
      {!ready ? (
        <p>正在载入…</p>
      ) : (
        <>
          <label className="app-selector">
            选择应用
            <select
              value={selected}
              onChange={(e) => {
                location.href = `/settings?appId=${encodeURIComponent(e.target.value)}`;
              }}
            >
              {apps.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {app ? (
            <div className="config-grid">
              <ConfigForm key={`apple:${app.id}`} scope="apple" app={app} />
              <ConfigForm key={`google:${app.id}`} scope="google" app={app} />
            </div>
          ) : (
            <p>请先在工作台添加应用，再填写商店配置。</p>
          )}
          <h2>AI 模型</h2>
          <div className="config-grid">
            <ConfigForm scope="text" />
            <ConfigForm scope="image" />
          </div>
        </>
      )}
    </div>
  );
}
