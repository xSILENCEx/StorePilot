"use client";

import { useEffect, useState } from "react";
import { ImageStudio } from "../components/image-studio";
import { useWorkspace } from "../lib/use-workspace";
import type { Platform, Draft, StoreApp as App } from "../lib/model";
import {
  Layers,
  Plus,
  ArrowLeft,
  Globe,
  ImagePlus,
  Settings,
  Save,
  Smartphone,
  Check,
  X,
} from "lucide-react";

const empty = (): Draft => ({
  title: "",
  subtitle: "",
  description: "",
  keywords: "",
  images: [],
});
const key = "storepilot.local.v1";

export default function Home() {
  const [message, setMessage] = useState("");
  const { apps, ready, saved, blocked, persist, retry } =
    useWorkspace(setMessage);
  const [jobs, setJobs] = useState<
    {
      id: string;
      kind: string;
      app_id: string;
      platform: string;
      status: string;
      result: unknown;
      logs: { step: string; message: string }[];
    }[]
  >([]);
  useEffect(() => {
    if (!ready) return;
    const refresh = () => {
      void fetch("/api/jobs", { cache: "no-store" })
        .then(async (r) => {
          if (r.ok) setJobs((await r.json()).jobs);
        })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [ready]);
  const [selected, select] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>("apple");
  const [locale, setLocale] = useState("en-US");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [apple, setApple] = useState("");
  const [google, setGoogle] = useState("");
  const app = apps.find((a) => a.id === selected);
  const [connection, setConnection] = useState<{
    appId: string;
    platform: string;
    configured: boolean;
    verified: boolean;
  } | null>(null);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    void fetch(`/api/settings/${platform}?appId=${selected}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        if (active)
          setConnection({
            appId: selected,
            platform,
            configured: data.configured,
            verified: data.verified,
          });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selected, platform]);
  const connectionConfigured =
    connection?.appId === selected &&
    connection.platform === platform &&
    connection.configured;
  const draftKey = `${platform}:${locale}`;
  const draft = app?.drafts[draftKey] ?? empty();
  const locales = app
    ? Object.keys(app.drafts)
        .filter((k) => k.startsWith(platform + ":"))
        .map((k) => k.slice(platform.length + 1))
    : [];
  function update(
    patch: Partial<Draft> | ((current: Draft) => Partial<Draft>),
  ) {
    if (app)
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
      select(id);
      setPlatform(apple.trim() ? "apple" : "google");
      setLocale("en-US");
      setModal(false);
      setName("");
      setApple("");
      setGoogle("");
      setEditing(null);
    }
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    const images: string[] = [];
    for (const file of Array.from(files)) {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/assets", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      images.push(data.url);
    }
    update((current) => ({ images: [...current.images, ...images] }));
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(apps, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "storepilot-drafts.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  async function importLegacy() {
    if (!saved || blocked) {
      setMessage("请等待当前资料保存后再导入");
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        setMessage("当前浏览器没有旧版草稿");
        return;
      }
      const old: App[] = JSON.parse(raw);
      const imported: App[] = [];
      for (const item of old) {
        if (apps.some((a) => a.id === item.id)) continue;
        const drafts: Record<string, Draft> = {};
        for (const [k, d] of Object.entries(item.drafts)) {
          const images: string[] = [];
          for (const image of d.images) {
            if (!image.startsWith("data:image/"))
              throw new Error("旧版草稿包含无效图片");
            const blob = await (await fetch(image)).blob();
            const form = new FormData();
            form.set("file", blob, "legacy");
            const r = await fetch("/api/assets", {
              method: "POST",
              body: form,
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error);
            images.push(data.url);
          }
          drafts[k] = { ...d, images };
        }
        imported.push({ ...item, drafts });
      }
      persist((current) => [
        ...current,
        ...imported.filter((item) => !current.some((a) => a.id === item.id)),
      ]);
      setMessage(`已导入 ${imported.length} 个应用，旧版数据仍保留在浏览器中`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "旧版导入失败");
    }
  }
  async function validate() {
    if (!app || !saved) return;
    try {
      const r = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: app.id, platform }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setMessage(`校验任务已入队：${data.id}，可在任务记录查看结果`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "入队失败");
    }
  }
  return (
    <div className="shell">
      <aside className="rail">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Layers size={22} />
          </span>
          StorePilot<span className="beta">LOCAL</span>
        </a>
        <div className="rail-label">工作空间</div>
        <button className="nav active" onClick={() => select(null)}>
          <Layers size={18} />
          应用管理<span>{apps.length}</span>
        </button>
        <a className="nav" href="/settings">
          <Settings size={18} />
          连接与模型配置
        </a>
        <div className="rail-bottom">
          <span className="dot" /> 本机工作台
          <small>PostgreSQL · 本机素材存储</small>
        </div>
      </aside>
      <main>
        <header>
          <span>
            工作空间 <span className="muted">/ {app?.name ?? "全部应用"}</span>
          </span>
          <span className="badge">
            <span className="dot" />
            管理员工作台
          </span>
        </header>
        {message && (
          <div role="alert" className="notice">
            {message}
            <button onClick={() => setMessage("")} aria-label="关闭提示">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="content">
          <a className="back" href="/settings">
            连接与模型配置 →
          </a>
          <div className="section-title">
            <button className="export" onClick={download}>
              导出当前草稿 JSON
            </button>
            <button
              className="export"
              disabled={!ready}
              onClick={() => void importLegacy()}
            >
              导入旧版浏览器草稿
            </button>
            <button
              className="export"
              disabled={!saved || blocked}
              onClick={() => {
                void fetch("/api/auth/sign-out", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                }).then((r) => {
                  if (r.ok) location.href = "/login";
                });
              }}
            >
              退出登录
            </button>
          </div>
          {blocked && (
            <div className="warning">
              自动保存已暂停。当前内容可导出备份。
              <button className="secondary" onClick={retry}>
                重试保存
              </button>
            </div>
          )}
          {!app ? (
            <>
              <div className="heading">
                <div>
                  <div className="eyebrow">YOUR STORE WORKSPACE</div>
                  <h1>应用管理</h1>
                  <p>在一个工作台，准备每个平台、每种语言的商店资料。</p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setEditing(null);
                    setName("");
                    setApple("");
                    setGoogle("");
                    setModal(true);
                  }}
                >
                  <Plus size={18} />
                  添加应用
                </button>
              </div>
              <div className="stats">
                <div>
                  <span>管理的应用</span>
                  <strong>{apps.length.toString().padStart(2, "0")}</strong>
                </div>
                <div>
                  <span>已启用平台</span>
                  <strong>
                    {apps
                      .reduce(
                        (s, a) => s + Number(!!a.apple) + Number(!!a.google),
                        0,
                      )
                      .toString()
                      .padStart(2, "0")}
                  </strong>
                </div>
                <div>
                  <span>当前阶段</span>
                  <strong className="stat-text">本地草稿</strong>
                </div>
              </div>
              <div className="section-title">
                <h2>全部应用</h2>
                <span>{apps.length} 个应用</span>
              </div>
              {!ready ? (
                <p>正在读取草稿…</p>
              ) : apps.length === 0 ? (
                <div className="empty">
                  <span className="empty-icon">
                    <Layers size={32} />
                  </span>
                  <h2>让你的下一个版本，从这里开始</h2>
                  <p>添加应用，开始整理多语言文案与商店截图。</p>
                  <button
                    className="primary"
                    onClick={() => {
                      setEditing(null);
                      setName("");
                      setApple("");
                      setGoogle("");
                      setModal(true);
                    }}
                  >
                    <Plus size={17} />
                    添加第一个应用
                  </button>
                </div>
              ) : (
                <div className="cards">
                  {apps.map((a) => (
                    <button
                      className="app-card"
                      key={a.id}
                      onClick={() => {
                        select(a.id);
                        setPlatform(a.apple ? "apple" : "google");
                        setLocale("en-US");
                      }}
                    >
                      <span className="app-icon">
                        {a.name.slice(0, 1).toUpperCase()}
                      </span>
                      <h2>{a.name}</h2>
                      <p>{a.apple || a.google}</p>
                      <div className="card-footer">
                        <span>
                          {a.apple && "Apple"}
                          {a.apple && a.google && " · "}
                          {a.google && "Google Play"}
                        </span>
                        <span>打开 →</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <button className="back" onClick={() => select(null)}>
                <ArrowLeft size={15} />
                全部应用
              </button>
              <div className="heading">
                <div>
                  <h1>{app.name}</h1>
                  <p>管理本地化内容与截图，准备下一次商店更新。</p>
                </div>
                <button
                  className="secondary"
                  onClick={() => {
                    setEditing(app.id);
                    setName(app.name);
                    setApple(app.apple);
                    setGoogle(app.google);
                    setModal(true);
                  }}
                >
                  应用设置
                </button>
                <span className="saved">
                  <Check size={15} />
                  {saved ? "已保存到服务器" : "正在保存…"}
                </span>
              </div>
              <div className="platform-tabs">
                {(["apple", "google"] as Platform[]).map((p) => (
                  <button
                    className={platform === p ? "selected" : ""}
                    key={p}
                    onClick={() => {
                      setPlatform(p);
                      setLocale("en-US");
                    }}
                  >
                    {p === "apple" ? "Apple App Store" : "Google Play"}
                    {!app[p] && <span>未启用</span>}
                  </button>
                ))}
              </div>
              <div className="warning">
                <a href={`/settings?appId=${app.id}`} aria-label="配置商店连接">
                  <Settings size={19} />
                </a>
                <div>
                  <b>
                    {app[platform]
                      ? connectionConfigured
                        ? connection?.verified
                          ? "应用/目录连接验证通过"
                          : "连接配置已填写 · 尚未验证"
                        : "商店尚未配置"
                      : "此平台尚未启用"}
                  </b>
                  <p>
                    点击设置图标填写连接配置。商店连接验证、同步、AI
                    翻译和推送尚未接入。
                  </p>
                </div>
              </div>
              {app[platform] ? (
                <div className="editor">
                  <aside className="languages">
                    <div className="section-title">
                      <h3>
                        <Globe size={16} />
                        语言
                      </h3>
                      <button
                        aria-label="添加语言"
                        onClick={() => {
                          const code = prompt(
                            "输入语言代码（仅本地草稿，官方目录尚未接入）",
                            "zh-Hans",
                          );
                          if (
                            code &&
                            /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)
                          ) {
                            const nextKey = `${platform}:${code}`;
                            if (!app.drafts[nextKey])
                              persist(
                                apps.map((a) =>
                                  a.id === app.id
                                    ? {
                                        ...a,
                                        drafts: {
                                          ...a.drafts,
                                          [nextKey]: empty(),
                                        },
                                      }
                                    : a,
                                ),
                              );
                            setLocale(code);
                          }
                        }}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    {locales.map((l) => (
                      <div
                        className={"language " + (locale === l ? "chosen" : "")}
                        key={l}
                      >
                        <button onClick={() => setLocale(l)}>{l}</button>
                        {locales.length > 1 && (
                          <button
                            aria-label={`删除 ${l}`}
                            onClick={() => {
                              if (!confirm(`删除 ${l} 的本地草稿？`)) return;
                              const drafts = { ...app.drafts };
                              delete drafts[`${platform}:${l}`];
                              if (
                                persist(
                                  apps.map((a) =>
                                    a.id === app.id ? { ...a, drafts } : a,
                                  ),
                                )
                              )
                                setLocale(locales.find((v) => v !== l)!);
                            }}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </aside>
                  <div className="editor-body">
                    <ImageStudio
                      key={`${app.id}:${platform}:${locale}`}
                      appId={app.id}
                      platform={platform}
                      locale={locale}
                      sourceImages={draft.images}
                      enabled={saved && !blocked}
                    />
                    <section>
                      <div className="section-title">
                        <div>
                          <h2>现有未分类截图 / 可复用素材</h2>
                          <p>为你的应用展示最出色的一面。</p>
                        </div>
                        <span className="badge">
                          <Smartphone size={14} />
                          未分类素材
                        </span>
                      </div>
                      <div className="screenshots">
                        {draft.images.map((src, i) => (
                          <div className="screenshot" key={i}>
                            <img src={src} alt={`截图 ${i + 1}`} />
                            <div className="sort">
                              <button
                                aria-label={`前移截图 ${i + 1}`}
                                disabled={i === 0}
                                onClick={() => {
                                  const images = [...draft.images];
                                  [images[i - 1], images[i]] = [
                                    images[i],
                                    images[i - 1],
                                  ];
                                  update({ images });
                                }}
                              >
                                ←
                              </button>
                              <button
                                aria-label={`后移截图 ${i + 1}`}
                                disabled={i === draft.images.length - 1}
                                onClick={() => {
                                  const images = [...draft.images];
                                  [images[i + 1], images[i]] = [
                                    images[i],
                                    images[i + 1],
                                  ];
                                  update({ images });
                                }}
                              >
                                →
                              </button>
                            </div>
                            <button
                              aria-label={`删除截图 ${i + 1}`}
                              onClick={() =>
                                update({
                                  images: draft.images.filter(
                                    (_, n) => n !== i,
                                  ),
                                })
                              }
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <label className="upload">
                          <ImagePlus size={26} />
                          <b>添加截图</b>
                          <span>PNG / JPEG · 每张 ≤ 20 MB</span>
                          <input
                            type="file"
                            multiple
                            accept="image/png,image/jpeg"
                            onChange={(e) => {
                              void upload(e.target.files).catch((e) =>
                                setMessage(
                                  e.message ?? "图片上传失败，请重试。",
                                ),
                              );
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                      <p className="hint">
                        素材暂未进行商店尺寸与数量校验，不能直接发布。
                      </p>
                    </section>
                    <section>
                      <div className="section-title">
                        <div>
                          <h2>元数据</h2>
                          <p>让世界各地的用户了解你的应用。</p>
                        </div>
                        <span className="badge">{locale}</span>
                      </div>
                      <div className="fields">
                        {(
                          [
                            "title",
                            "subtitle",
                            "description",
                            "keywords",
                          ] as const
                        ).map((f) => (
                          <label
                            key={f}
                            className={f === "description" ? "wide" : ""}
                          >
                            <span>
                              {
                                {
                                  title: "应用名称",
                                  subtitle:
                                    platform === "apple"
                                      ? "副标题"
                                      : "简短描述",
                                  description: "完整描述",
                                  keywords:
                                    "关键词 / 内部备注（Google 不上传）",
                                }[f]
                              }
                            </span>
                            {f === "description" ? (
                              <textarea
                                rows={8}
                                value={draft[f]}
                                onChange={(e) =>
                                  update({ [f]: e.target.value })
                                }
                                placeholder="介绍应用的功能与价值…"
                              />
                            ) : (
                              <input
                                value={draft[f]}
                                onChange={(e) =>
                                  update({ [f]: e.target.value })
                                }
                                placeholder="输入内容"
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    </section>
                    <footer className="editor-footer">
                      <span>
                        <Save size={15} />
                        {saved ? "已保存为服务端草稿" : "保存中，请勿关闭页面"}
                      </span>
                      <button
                        className="secondary"
                        disabled={!saved || blocked}
                        onClick={() => void validate()}
                      >
                        后台校验草稿
                      </button>
                      <button disabled className="primary">
                        推送到 {platform === "apple" ? "Apple" : "Google"}
                      </button>
                    </footer>
                  </div>
                </div>
              ) : (
                <div className="empty">
                  <h2>创建应用时未配置此平台</h2>
                  <p>平台连接设置将在下一阶段提供。</p>
                </div>
              )}
            </>
          )}
          {ready && (
            <section className="tasks">
              <h2>持久化任务记录</h2>
              <p>
                每 3 秒刷新；关闭页面后 Worker
                继续执行。校验范围暂为字段长度和素材可读性。
              </p>
              {jobs
                .filter((j) => !app || j.app_id === app.id)
                .map((j) => (
                  <div className="task" key={j.id}>
                    <b>
                      {j.platform} ·{" "}
                      {(
                        {
                          queued: "排队中",
                          running: "执行中",
                          retrying: "等待自动重试",
                          failed: "失败",
                          succeeded: "完成",
                        } as Record<string, string>
                      )[j.status] ?? j.status}
                    </b>
                    {j.status === "failed" && j.kind === "validate_draft" && (
                      <button
                        className="secondary"
                        onClick={() => {
                          void fetch("/api/jobs", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ retryId: j.id }),
                          })
                            .then(async (r) => {
                              const data = await r.json();
                              setMessage(
                                r.ok
                                  ? "已创建重试任务（使用原冻结草稿）"
                                  : data.error,
                              );
                            })
                            .catch(() => setMessage("重试失败"));
                        }}
                      >
                        重试原任务
                      </button>
                    )}
                    <small> {j.id}</small>
                    {j.logs.map((l, i) => (
                      <p key={i}>
                        {l.step}：{l.message}
                      </p>
                    ))}
                    {j.result != null && (
                      <pre>{JSON.stringify(j.result, null, 2)}</pre>
                    )}
                  </div>
                ))}
            </section>
          )}
        </div>
      </main>
      {modal && (
        <div className="overlay">
          <form className="modal" onSubmit={create}>
            <div className="section-title">
              <h2>{editing ? "应用设置" : "添加应用"}</h2>
              <button
                type="button"
                onClick={() => setModal(false)}
                aria-label="关闭"
              >
                <X size={20} />
              </button>
            </div>
            <p>填写名称与至少一个平台的应用标识。</p>
            <label>
              应用名称
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：我的应用"
              />
            </label>
            <label>
              Apple Bundle ID
              <input
                value={apple}
                onChange={(e) => setApple(e.target.value)}
                placeholder="com.example.app"
              />
            </label>
            <label>
              Google 包名
              <input
                value={google}
                onChange={(e) => setGoogle(e.target.value)}
                placeholder="com.example.app"
              />
            </label>
            <p className="hint">此处不收集商店密钥。</p>
            <button
              className="primary"
              disabled={!name.trim() || (!apple.trim() && !google.trim())}
            >
              {editing ? "保存设置" : "创建应用"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
