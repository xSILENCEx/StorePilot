"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StoreApp } from "./model";
export function useWorkspace(onError: (message: string) => void) {
  const [apps, setApps] = useState<StoreApp[]>([]);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const revision = useRef(0);
  const latest = useRef(apps);
  const version = useRef(0);
  const stored = useRef(0);
  const saving = useRef(false);
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
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        revision.current = data.revision;
        latest.current = data.apps;
        setApps(data.apps);
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
  const flush = useCallback(async () => {
    if (saving.current || halted.current || stored.current === version.current)
      return;
    saving.current = true;
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
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "保存失败");
        revision.current = data.revision;
        stored.current = current;
      }
      setSaved(true);
    } catch (e) {
      halted.current = true;
      setBlocked(true);
      errorRef.current(e instanceof Error ? e.message : "保存失败");
    } finally {
      saving.current = false;
    }
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
  return { apps, ready, saved, blocked, persist, retry };
}
