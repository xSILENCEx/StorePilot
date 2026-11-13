"use client";
import { useEffect, useRef, useState } from "react";
import {
  devices,
  deviceFor,
  screenshotSettings,
  type ScreenshotSettings,
  type ScreenshotGroup,
  type ImageCandidate,
} from "../lib/screenshot-model";
import { ScreenshotTemplate } from "./screenshot-template";
type Props = {
  appId: string;
  platform: "apple" | "google";
  locale: string;
  sourceImages: string[];
  enabled: boolean;
};
async function api(url: string, body?: unknown, method = "POST") {
  const r = await fetch(
    url,
    body === undefined
      ? { cache: "no-store" }
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (r.status === 401) {
    location.href = "/login";
    throw new Error("请先登录");
  }
  if (!r.ok) throw new Error(data.error ?? "操作失败");
  return data;
}
const statusNames: Record<string, string> = {
  queued: "排队中",
  running: "生成 / 渲染中",
  succeeded: "可预览",
  failed: "失败",
  uncertain: "调用结果未知",
};
export function ImageStudio(props: Props) {
  const available = devices.filter((d) => d.platform === props.platform);
  const [device, setDevice] = useState<string>(available[0].id);
  return (
    <section className="image-studio">
      <div className="section-title">
        <div>
          <h2>AI 截图工作室</h2>
          <p>选择设备 → 上传真实截图 / 参考素材 → 生成候选 → 预览采用</p>
        </div>
        <a className="export" href="/settings">
          图像模型设置 ↗
        </a>
      </div>
      <div className="device-tabs" role="tablist" aria-label="截图设备">
        {available.map((d) => (
          <button
            role="tab"
            aria-selected={device === d.id}
            className={device === d.id ? "selected" : ""}
            key={d.id}
            onClick={() => setDevice(d.id)}
          >
            {d.name}
            <small>
              {d.width} × {d.height}
            </small>
          </button>
        ))}
      </div>
      <Studio
        key={`${props.appId}:${props.platform}:${props.locale}:${device}`}
        {...props}
        device={device}
      />
    </section>
  );
}
function Studio({ device: deviceId, ...props }: Props & { device: string }) {
  const device = deviceFor(deviceId);
  const [group, setGroup] = useState<ScreenshotGroup | null>(null);
  const [settings, setSettings] = useState<ScreenshotSettings>(
    screenshotSettings.parse({}),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    url: string;
    label: string;
    format?: string;
  } | null>(null);
  const [imageConfig, setImageConfig] = useState<{
    configured: boolean;
    model?: string;
  } | null>(null);
  const [refs, setRefs] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const pendingRequest = useRef<{
    id: string;
    revision: number;
    reuse?: string;
  } | null>(null);
  const baseRevision = useRef(0);
  const live = useRef({ group, settings, dirty });
  live.current = { group, settings, dirty };
  const storageKey = (id: string) => `storepilot.screenshot.pending:${id}`;
  const groupUrl = group ? `/api/screenshots/${group.id}` : "";
  async function load(discard = false) {
    if (!props.enabled && !group) return;
    setError("");
    try {
      const next: ScreenshotGroup = await api("/api/screenshots", {
        appId: props.appId,
        platform: props.platform,
        locale: props.locale,
        device: deviceId,
      });
      setGroup(next);
      baseRevision.current = next.revision;
      if (discard) localStorage.removeItem(storageKey(next.id));
      const cached = localStorage.getItem(storageKey(next.id));
      if (cached) {
        const value = JSON.parse(cached);
        setSettings(screenshotSettings.parse(value.settings));
        baseRevision.current = value.revision;
        setDirty(true);
        setError(
          value.revision !== next.revision
            ? "发现本机待保存配置，但服务器版本已变更。请导出配置备份后重新载入，避免覆盖其他窗口修改。"
            : "已恢复本机待保存的生成配置，点击保存或生成后写入服务器。",
        );
      } else {
        setSettings(next.settings);
        setDirty(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法读取截图组");
    }
  }
  useEffect(() => {
    if (!group && props.enabled) void load();
  }, [props.enabled]);
  useEffect(() => {
    void api("/api/settings/image")
      .then((data) =>
        setImageConfig({
          configured: data.configured,
          model: data.fields.model,
        }),
      )
      .catch(() => setImageConfig(null));
  }, []);
  useEffect(() => {
    if (
      !group?.candidates.some((c) => ["queued", "running"].includes(c.status))
    )
      return;
    const timer = setInterval(() => {
      void api(groupUrl)
        .then((next: ScreenshotGroup) => {
          setGroup(next);
          if (!live.current.dirty) {
            baseRevision.current = next.revision;
            setSettings(next.settings);
          }
        })
        .catch(() =>
          setError("暂时无法刷新任务，后台生成不会停止；可点击重新载入。"),
        );
    }, 2000);
    return () => clearInterval(timer);
  }, [
    group?.id,
    group?.candidates.some((c) => ["queued", "running"].includes(c.status)),
  ]);
  function edit(patch: Partial<ScreenshotSettings>) {
    if (!group) return;
    const next = { ...live.current.settings, ...patch };
    setSettings(next);
    setDirty(true);
    live.current = { group, settings: next, dirty: true };
    pendingRequest.current = null;
    try {
      localStorage.setItem(
        storageKey(group.id),
        JSON.stringify({ revision: baseRevision.current, settings: next }),
      );
    } catch {
      setError("浏览器待保存备份失败，请尽快点击保存配置");
    }
  }
  async function save(value = live.current.settings) {
    if (!group) throw new Error("截图组尚未载入");
    const next: ScreenshotGroup = await api(
      groupUrl,
      { revision: baseRevision.current, settings: value },
      "PUT",
    );
    setGroup(next);
    setSettings(next.settings);
    baseRevision.current = next.revision;
    setDirty(false);
    live.current = { group: next, settings: next.settings, dirty: false };
    localStorage.removeItem(storageKey(group.id));
    return next;
  }
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (!group) return;
    const next: ScreenshotGroup = await api(groupUrl);
    setGroup(next);
    if (!live.current.dirty) {
      baseRevision.current = next.revision;
      setSettings(next.settings);
    }
  }
  async function generate(
    reuse?: string,
    candidateSettings?: ScreenshotSettings,
  ) {
    await action(async () => {
      if (!group) return;
      let current = live.current.group!;
      if (live.current.dirty || candidateSettings)
        current = await save(candidateSettings ?? live.current.settings);
      let request = pendingRequest.current;
      if (
        !request ||
        request.revision !== current.revision ||
        request.reuse !== reuse
      ) {
        request = {
          id: crypto.randomUUID(),
          revision: current.revision,
          reuse,
        };
        pendingRequest.current = request;
      }
      await api(`${groupUrl}/generate`, {
        revision: request.revision,
        requestId: request.id,
        ...(reuse ? { reuseCandidateId: reuse } : {}),
      });
      await refresh();
      pendingRequest.current = null;
    });
  }
  async function adopt(body: unknown) {
    await action(async () => {
      if (live.current.dirty) await save();
      await api(`${groupUrl}/adopt`, {
        revision: baseRevision.current,
        ...(body as object),
      });
      await refresh();
    });
  }
  async function upload(file: File, kind: "screenshot" | "art" | "finished") {
    if (file.size > 20 * 1024 * 1024) throw new Error("单个素材不能超过 20 MB");
    const form = new FormData();
    form.set("file", file);
    const r = await fetch("/api/assets", { method: "POST", body: form });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error);
    setRefs((current) => [...current, result.url]);
    if (kind === "finished") {
      await api(`${groupUrl}/upload`, { url: result.url });
      await refresh();
    } else edit({ [kind]: result.url });
  }
  const availableSources = [
    ...new Set(
      [
        ...props.sourceImages,
        ...refs,
        settings.screenshot,
        settings.art,
      ].filter((v): v is string => !!v),
    ),
  ];
  function exportSettings() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(settings, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `screenshot-${props.locale}-${device.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const previewWidth = 240;
  const scale = previewWidth / device.width;
  const pending =
    group?.candidates.filter((c) => ["queued", "running"].includes(c.status))
      .length ?? 0;
  return (
    <>
      <div className="studio-context">
        <span className="badge">
          {props.platform} · {props.locale} · {device.width} × {device.height}
        </span>
        <span>
          {dirty ? "有待保存配置（已在本机暂存）" : "生成配置已保存"}
          {imageConfig?.configured
            ? ` · 模型：${imageConfig.model}`
            : " · 尚未配置图像模型"}
        </span>
      </div>
      {error && (
        <div role="alert" className="warning">
          {error}
        </div>
      )}
      {!group ? (
        <div className="empty">
          <p>
            {props.enabled
              ? "截图组尚未载入"
              : "请等待应用草稿保存后载入截图工作室"}
          </p>
          <button
            className="secondary"
            disabled={!props.enabled || busy}
            onClick={() => void load()}
          >
            重新载入
          </button>
        </div>
      ) : (
        <>
          <div className="studio-layout">
            <div>
              <fieldset disabled={busy} className="studio-fields">
                <label>
                  <span>生成方式</span>
                  <select
                    value={settings.mode}
                    onChange={(e) =>
                      edit({
                        mode: e.target.value as ScreenshotSettings["mode"],
                      })
                    }
                  >
                    <option value="template-ai">
                      AI 背景 + 真实截图（推荐）
                    </option>
                    <option value="image-ai">AI 整图 / 参考图改图</option>
                    <option value="template">
                      仅固定模板渲染（不调用模型）
                    </option>
                  </select>
                </label>
                <div className="fields">
                  {(["screenshot", "art"] as const).map((kind) => (
                    <label key={kind}>
                      <span>
                        {kind === "screenshot"
                          ? "真实 App 截图"
                          : "美术 / 风格参考图（可选）"}
                      </span>
                      <select
                        value={settings[kind] ?? ""}
                        onChange={(e) =>
                          edit({ [kind]: e.target.value || null })
                        }
                      >
                        <option value="">未选择</option>
                        {availableSources.map((url, i) => (
                          <option key={url} value={url}>
                            素材 {i + 1} · {url.slice(-8)}
                          </option>
                        ))}
                      </select>
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        aria-label={`上传${kind === "screenshot" ? "真实截图" : "参考图"}`}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) void action(() => upload(file, kind));
                        }}
                      />
                      {settings[kind] && (
                        <img
                          className="source-thumb"
                          src={settings[kind]!}
                          alt={
                            kind === "screenshot"
                              ? "选中的真实截图"
                              : "选中的参考图"
                          }
                        />
                      )}
                    </label>
                  ))}
                </div>
                <p className="hint">
                  {settings.mode === "template-ai"
                    ? "真实截图仅在本机合成，不发送给图像模型；美术参考图（如已选择）会发送给模型。文字由模板绘制，保持可编辑。"
                    : settings.mode === "image-ai"
                      ? "选中的真实截图与参考图将发送到已配置的模型，属于模型改图。请预览核对 App UI 与文字；不选素材时按提示词生成整图。"
                      : "完全本机渲染：真实截图与美术图不会发送到模型服务。"}
                </p>
                <label>
                  <span>主标题</span>
                  <input
                    maxLength={100}
                    value={settings.headline}
                    onChange={(e) => edit({ headline: e.target.value })}
                    placeholder="例如：每一笔，都井井有条"
                  />
                </label>
                <label>
                  <span>副文案</span>
                  <textarea
                    rows={2}
                    maxLength={240}
                    value={settings.subtitle}
                    onChange={(e) => edit({ subtitle: e.target.value })}
                  />
                </label>
                <label>
                  <span>
                    {settings.mode === "template-ai"
                      ? "背景画面提示词"
                      : "图片生成提示词"}
                  </span>
                  <textarea
                    rows={4}
                    maxLength={8000}
                    value={settings.prompt}
                    onChange={(e) => edit({ prompt: e.target.value })}
                    placeholder="描述配色、风格、光影和构图…"
                  />
                </label>
                <div className="fields">
                  <label>
                    <span>固定模板</span>
                    <select
                      value={settings.template}
                      onChange={(e) =>
                        edit({ template: e.target.value as "hero" | "split" })
                      }
                    >
                      <option value="hero">居中展示</option>
                      <option value="split">左右分栏</option>
                    </select>
                  </label>
                  <label>
                    <span>输出格式</span>
                    <select
                      value={settings.output}
                      onChange={(e) =>
                        edit({ output: e.target.value as "png" | "jpeg" })
                      }
                    >
                      <option value="png">PNG</option>
                      <option value="jpeg">JPEG</option>
                    </select>
                  </label>
                  <label>
                    <span>背景色</span>
                    <input
                      type="color"
                      value={settings.background}
                      onChange={(e) => edit({ background: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>文字色</span>
                    <input
                      type="color"
                      value={settings.foreground}
                      onChange={(e) => edit({ foreground: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>模型请求尺寸</span>
                    <select
                      value={settings.modelSize}
                      onChange={(e) =>
                        edit({
                          modelSize: e.target
                            .value as ScreenshotSettings["modelSize"],
                        })
                      }
                    >
                      {["auto", "1024x1024", "1024x1536", "1536x1024"].map(
                        (v) => (
                          <option key={v}>{v}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    <span>模型质量</span>
                    <select
                      value={settings.quality}
                      onChange={(e) =>
                        edit({
                          quality: e.target
                            .value as ScreenshotSettings["quality"],
                        })
                      }
                    >
                      {["auto", "low", "medium", "high"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>整图适配</span>
                    <select
                      value={settings.imageFit}
                      onChange={(e) =>
                        edit({
                          imageFit: e.target.value as "contain" | "cover",
                        })
                      }
                    >
                      <option value="contain">完整保留，边缘补背景</option>
                      <option value="cover">铺满，允许裁切</option>
                    </select>
                  </label>
                </div>
              </fieldset>
              <div className="config-actions">
                <button
                  className="secondary"
                  disabled={busy || !dirty}
                  onClick={() =>
                    void action(async () => {
                      await save();
                    })
                  }
                >
                  保存生成配置
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    pending >= 4 ||
                    (settings.mode !== "template" && !imageConfig?.configured)
                  }
                  onClick={() => void generate()}
                >
                  {settings.mode === "template"
                    ? "渲染候选（本机）"
                    : "生成一张候选（调用模型）"}
                </button>
                <button className="export" onClick={exportSettings}>
                  导出配置
                </button>
                <button
                  className="export"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !dirty ||
                      confirm("丢弃本机待保存配置并重新载入服务端版本？")
                    )
                      void load(true);
                  }}
                >
                  重新载入
                </button>
              </div>
              <p className="hint">
                每次只生成一张，最多排队 4
                张。模型调用可能计费；超时结果未知时不自动再次调用。已采用截图始终保持不变。
              </p>
            </div>
            <aside className="template-preview">
              <h3>模板预览</h3>
              {settings.mode === "image-ai" ? (
                <p>整图以生成候选为准；此模式不在本机绘制文字。</p>
              ) : (
                <div
                  style={{
                    width: previewWidth,
                    height: device.height * scale,
                    overflow: "hidden",
                    borderRadius: 10,
                  }}
                >
                  <div
                    style={{
                      transform: `scale(${scale})`,
                      transformOrigin: "top left",
                    }}
                  >
                    <ScreenshotTemplate
                      settings={settings}
                      width={device.width}
                      height={device.height}
                      screenshot={settings.screenshot}
                      background={settings.art}
                    />
                  </div>
                </div>
              )}
              <p className="hint">
                AI 背景生成后以候选图为准。模板预览与输出使用同一个 React 组件。
              </p>
              <label className="finished-upload">
                <span>或上传成品截图</span>
                <input
                  disabled={busy}
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void action(() => upload(file, "finished"));
                  }}
                />
                <small>
                  必须为 {device.width} × {device.height}
                  ，不含透明通道。先进入候选区，预览后采用。
                </small>
              </label>
            </aside>
          </div>
          <div className="section-title">
            <div>
              <h3>
                已采用截图 · {group.adopted.length} / {device.max}
              </h3>
              <p>按当前设备独立排序，可下载最终尺寸文件。</p>
            </div>
            <button
              className="secondary"
              disabled={busy || !group.has_previous}
              onClick={() => void adopt({ action: "restore" })}
            >
              恢复上次采用结果
            </button>
          </div>
          <div className="candidate-grid adopted-grid">
            {group.adopted.map((item, index) => (
              <div className="candidate" key={item.candidateId}>
                <button
                  className="candidate-image"
                  onClick={() =>
                    setPreview({
                      url: item.url,
                      label: `已采用 ${index + 1}`,
                      format: item.format,
                    })
                  }
                >
                  <img src={item.thumbnail} alt={`已采用截图 ${index + 1}`} />
                </button>
                <div className="candidate-actions">
                  <button
                    disabled={busy || index === 0}
                    onClick={() => {
                      const order = group.adopted.map((a) => a.candidateId);
                      [order[index - 1], order[index]] = [
                        order[index],
                        order[index - 1],
                      ];
                      void adopt({ action: "reorder", order });
                    }}
                  >
                    ←
                  </button>
                  <button
                    disabled={busy || index === group.adopted.length - 1}
                    onClick={() => {
                      const order = group.adopted.map((a) => a.candidateId);
                      [order[index + 1], order[index]] = [
                        order[index],
                        order[index + 1],
                      ];
                      void adopt({ action: "reorder", order });
                    }}
                  >
                    →
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void adopt({
                        action: "reorder",
                        order: group.adopted
                          .filter((a) => a.candidateId !== item.candidateId)
                          .map((a) => a.candidateId),
                      })
                    }
                  >
                    移除
                  </button>
                  <a
                    href={item.url}
                    download={`${props.platform}-${props.locale}-${device.id}-${index + 1}.${item.format === "jpeg" ? "jpg" : "png"}`}
                  >
                    下载
                  </a>
                </div>
                <small>
                  {item.origin === "image-ai"
                    ? "AI 整图 / 改图"
                    : item.origin === "upload"
                      ? "上传成品"
                      : "真实截图模板"}{" "}
                  · {item.width} × {item.height}
                </small>
              </div>
            ))}
            {!group.adopted.length && <p>尚未采用候选。</p>}
          </div>
          <div className="section-title">
            <h3>候选结果 {pending > 0 && `· ${pending} 个后台任务`}</h3>
            <label>
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
              />
              显示已隐藏候选
            </label>
          </div>
          <div className="candidate-grid">
            {group.candidates
              .filter((c) => showHidden || !c.discarded)
              .map((candidate) => (
                <Candidate
                  key={candidate.id}
                  candidate={candidate}
                  busy={busy}
                  onPreview={() =>
                    candidate.url &&
                    setPreview({
                      url: candidate.url,
                      label: "候选预览",
                      format: candidate.settings.output,
                    })
                  }
                  onAdopt={(replace) =>
                    void adopt({
                      action: replace ? "replace" : "append",
                      candidateId: candidate.id,
                    })
                  }
                  onGenerate={() =>
                    void generate(undefined, candidate.settings)
                  }
                  onRender={() => void generate(candidate.id)}
                  onResume={() =>
                    void action(async () => {
                      await api(
                        `${groupUrl}/candidates/${candidate.id}/resume`,
                        {},
                      );
                      await refresh();
                    })
                  }
                  onHide={() =>
                    void action(async () => {
                      await api(
                        `${groupUrl}/candidates/${candidate.id}`,
                        {},
                        candidate.discarded ? "PUT" : "DELETE",
                      );
                      await refresh();
                    })
                  }
                />
              ))}
            {!group.candidates.length && (
              <p>生成结果会出现在这里，不会自动替换已采用截图。</p>
            )}
          </div>
        </>
      )}
      {preview && (
        <div
          className="overlay image-preview"
          role="dialog"
          aria-modal="true"
          aria-label={preview.label}
        >
          <div>
            <button className="secondary" onClick={() => setPreview(null)}>
              关闭预览
            </button>
            <a
              className="primary"
              href={preview.url}
              download={`${props.platform}-${props.locale}-screenshot.${preview.format === "jpeg" ? "jpg" : "png"}`}
            >
              下载原尺寸
            </a>
            <img src={preview.url} alt={preview.label} />
          </div>
        </div>
      )}
    </>
  );
}
function Candidate({
  candidate: c,
  busy,
  onPreview,
  onAdopt,
  onGenerate,
  onRender,
  onResume,
  onHide,
}: {
  candidate: ImageCandidate;
  busy: boolean;
  onPreview: () => void;
  onAdopt: (replace: boolean) => void;
  onGenerate: () => void;
  onRender: () => void;
  onResume: () => void;
  onHide: () => void;
}) {
  return (
    <div className={"candidate " + (c.discarded ? "hidden-candidate" : "")}>
      <span className="badge">
        {statusNames[c.status] ?? c.status}
        {c.discarded ? " · 已隐藏" : ""}
      </span>
      {c.thumbnail ? (
        <button className="candidate-image" onClick={onPreview}>
          <img src={c.thumbnail} alt="生成候选截图" />
        </button>
      ) : (
        <div className="candidate-placeholder">
          {["queued", "running"].includes(c.status)
            ? "后台处理中…"
            : "未生成成品"}
        </div>
      )}
      <small>
        {c.origin === "template-ai"
          ? "AI 背景 + 真实截图"
          : c.origin === "image-ai"
            ? "AI 整图 / 改图"
            : c.origin === "upload"
              ? "上传成品"
              : "本机固定模板"}
        <br />
        {new Date(c.created_at).toLocaleString()}
      </small>
      {c.error && <p className="candidate-error">{c.error}</p>}
      <div className="candidate-actions">
        {c.status === "succeeded" && !c.discarded && (
          <>
            <button disabled={busy} onClick={() => onAdopt(false)}>
              追加采用
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    "用此候选替换当前设备的全部已采用截图？可恢复上次结果。",
                  )
                )
                  onAdopt(true);
              }}
            >
              替换整组
            </button>
          </>
        )}
        {c.has_raw && !["queued", "running"].includes(c.status) && (
          <button disabled={busy} onClick={onRender}>
            用当前配置重渲染（不调用模型）
          </button>
        )}
        {c.origin !== "upload" && (
          <button
            disabled={busy || ["queued", "running"].includes(c.status)}
            onClick={onGenerate}
          >
            按此配置重新生成
          </button>
        )}
        {["failed", "uncertain"].includes(c.status) && (
          <button disabled={busy} onClick={onResume}>
            仅重试已保存结果处理
          </button>
        )}
        {!["queued", "running"].includes(c.status) && (
          <button disabled={busy} onClick={onHide}>
            {c.discarded ? "恢复候选" : "隐藏候选"}
          </button>
        )}
      </div>
    </div>
  );
}
