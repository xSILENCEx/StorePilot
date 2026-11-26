"use client";
import { readApiResponse } from "./api-response";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StoreApp } from "./model";
export function useWorkspace(onError: (message: string) => void) {
  const [apps, setApps] = useState<StoreApp[]>([]);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const revision = useRef(0);
  const readVersion = useRef("");
  const latest = useRef(apps);
  const version = useRef(0);
  const stored = useRef(0);
  const saving = useRef<Promise<boolean> | null>(null);
  const halted = useRef(false);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const load = useCallback(async () => {
    await fetch("/api/apps", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          location.href = "/login";
          return;
        }
        const data = await readApiResponse(r);
        revision.current = data.revision;
        readVersion.current = data.readVersion;
        latest.current = data.apps;
        setApps(data.apps);
        errorRef.current("");
        setReady(true);
        setBlocked(false);
      })
      .catch((e) => {
        setBlocked(true);
        errorRef.current(e.message);
      });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Background translations commit a new workspace revision independently of this tab.
  useEffect(() => {
    if (!ready) return;
    let active = true;
    let pending = false;
    async function refresh() {
      if (
        document.hidden ||
        pending ||
        saving.current ||
        halted.current ||
        version.current !== stored.current
      )
        return;
      const base = revision.current;
      const edit = version.current;
      pending = true;
      try {
        const response = await fetch(
          "/api/apps?version=" + readVersion.current,
          {
            cache: "no-store",
          },
        );
        if (!response.ok || response.status === 204) return;
        const data = await response.json();
        if (
          active &&
          revision.current === base &&
          version.current === edit &&
          !halted.current
        ) {
          revision.current = data.revision;
          readVersion.current = data.readVersion;
          latest.current = data.apps;
          setApps(data.apps);
        }
      } catch {
        /* Retry on the next poll. */
      } finally {
        pending = false;
      }
    }
    const timer = setInterval(refresh, 4000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [ready]);
  const flush = useCallback((): Promise<boolean> => {
    if (saving.current) return saving.current;
    if (stored.current === version.current) return Promise.resolve(true);
    if (halted.current) return Promise.resolve(false);
    async function save() {
      try {
        while (stored.current !== version.current) {
          const current = version.current;
          const response = await fetch("/api/apps", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apps: latest.current,
              revision: revision.current,
            }),
          });
          const data = await readApiResponse(response, "保存失败");
          revision.current = data.revision;
          stored.current = current;
        }
        setSaved(true);
        errorRef.current("");
        return true;
      } catch (e) {
        halted.current = true;
        setBlocked(true);
        errorRef.current(e instanceof Error ? e.message : "保存失败");
        return false;
      }
    }
    saving.current = save().finally(() => {
      saving.current = null;
    });
    return saving.current;
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      void flush();
    }, 500);
    return () => clearTimeout(timer);
  }, [apps, ready, flush]);
  useEffect(() => {
    function unload(e: BeforeUnloadEvent) {
      if (version.current !== stored.current) e.preventDefault();
    }
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  function persist(value: StoreApp[] | ((current: StoreApp[]) => StoreApp[])) {
    if (!ready || halted.current) {
      errorRef.current("尚未载入或保存已暂停，请先处理错误并重试。");
      return false;
    }
    const next = typeof value === "function" ? value(latest.current) : value;
    latest.current = next;
    version.current++;
    setSaved(false);
    setApps(next);
    return true;
  }
  function retry() {
    halted.current = false;
    setBlocked(false);
    if (!ready) void load();
    else void flush();
  }
  return {
    apps,
    ready,
    saved,
    blocked,
    flush,
    persist,
    retry,
    revision: revision.current,
  };
}
