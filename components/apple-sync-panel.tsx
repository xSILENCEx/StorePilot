"use client";
import { useEffect, useState } from "react";
import type { StoreApp } from "../lib/model";
import {
  importMissing,
  textDiff,
  type AppleSnapshot,
} from "../lib/apple-sync-model";
type State = {
  snapshot: AppleSnapshot | null;
  previous: AppleSnapshot | null;
  stale: boolean;
  job: { status: string; result?: { error?: string; message?: string } } | null;
};
export function AppleSyncPanel({
  app,
  enabled,
  onImport,
}: {
  app: StoreApp;
  enabled: boolean;
  onImport: (snapshot: AppleSnapshot) => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [appInfoId, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const r = await fetch(`/api/apple-sync?appId=${app.id}`, {
          cache: "no-store",
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (active) {
          setState(data);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "读取快照失败");
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [app.id]);
  const pending =
    busy || ["queued", "running"].includes(state?.job?.status ?? "");
  const snapshot = state?.snapshot;
  const missing = snapshot
    ? Object.keys(importMissing(app.drafts, snapshot)).length -
      Object.keys(app.drafts).length
    : 0;
  return (
    <section className="apple-sync-panel">
      <h3>Apple 商店文案</h3>
      <p>
        按连接设置的目标平台与版本只读拉取。已有草稿不会被覆盖，推送尚未开放。
      </p>
      <label>
        应用资料 ID（仅存在多个资料版本时需要）{" "}
        <input
          value={appInfoId}
          onChange={(e) => setInfo(e.target.value)}
          placeholder="默认使用唯一的应用资料"
        />
      </label>
      <button
        disabled={!enabled || pending || !state}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await fetch("/api/apple-sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ appId: app.id, appInfoId }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error);
            setState((s) => s && { ...s, job: { status: "queued" } });
          } catch (e) {
            setError(e instanceof Error ? e.message : "入队失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        {pending ? "拉取中…" : "拉取远端文案"}
      </button>
      {error && <p role="alert">{error}</p>}
      {state?.job && (
        <p role="status">
          任务：{state.job.status}{" "}
          {state.job.result?.error ?? state.job.result?.message}
        </p>
      )}
      {snapshot && (
        <>
          <p>
            目标：{snapshot.target.platform} / {snapshot.target.version}（
            {snapshot.target.versionState}）；应用资料：
            {snapshot.target.appInfoId}（{snapshot.target.appInfoState}）<br />
            最后成功读取：{new Date(snapshot.fetchedAt).toLocaleString()}
          </p>
          {state?.stale && (
            <p role="alert">连接配置已改变，此快照已过期。请重新拉取后导入。</p>
          )}
          <button
            disabled={!enabled || pending || state?.stale || !missing}
            onClick={() => onImport(snapshot)}
          >
            导入缺少的 {missing} 种语言（保留已有草稿）
          </button>
          {Object.entries(snapshot.locales).map(([locale, entry]) => {
            const local = app.drafts[`apple:${locale}`];
            const differences = textDiff(local, entry.draft);
            const previous = state?.previous?.locales[locale]?.draft;
            return (
              <details key={locale}>
                <summary>
                  {locale} ·{" "}
                  {local
                    ? differences.length
                      ? `${differences.length} 个字段与草稿不同`
                      : "文案一致"
                    : "尚未导入"}
                  {!entry.appInfoLocalizationId || !entry.versionLocalizationId
                    ? " · 应用级/版本级语言不完整"
                    : ""}
                </summary>
                {differences.map((field) => (
                  <div key={field}>
                    <b>{field}</b>
                    <div className="apple-sync-values">
                      <div>
                        本地草稿<pre>{local?.[field] ?? "（无草稿）"}</pre>
                      </div>
                      <div>
                        最新远端<pre>{entry.draft[field] || "（空）"}</pre>
                      </div>
                      {previous && (
                        <div>
                          上次远端<pre>{previous[field] || "（空）"}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </details>
            );
          })}
        </>
      )}
    </section>
  );
}
