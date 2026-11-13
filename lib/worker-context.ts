import { AsyncLocalStorage } from "node:async_hooks";
import { sqlite } from "./db";
export const workerContext = new AsyncLocalStorage<string>();
// Fence a paused or disconnected worker before it performs another side effect.
export function assertWorkerActive() {
  const owner = workerContext.getStore();
  if (!owner) return;
  const lease = sqlite()
    .prepare("select owner,expires_at from worker_lease where id=1")
    .get() as { owner: string; expires_at: number } | undefined;
  if (lease?.owner !== owner || lease.expires_at <= Date.now())
    throw new Error("Worker lease expired");
}
