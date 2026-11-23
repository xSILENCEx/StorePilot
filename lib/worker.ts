import { workerContext } from "./worker-context";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sqlite } from "./db";
import { connectionConfigs, jobs } from "./schema";
import { finishJob, logJob } from "./job-store";
import { savedReply } from "./image-provider";
const leaseMs = 30000;
export function acquireWorker(owner: string, now = Date.now()) {
  return (
    sqlite()
      .prepare(
        "insert into worker_lease(id,owner,expires_at) values(1,?,?) on conflict(id) do update set owner=excluded.owner,expires_at=excluded.expires_at where worker_lease.expires_at <= ? or worker_lease.owner = ?",
      )
      .run(owner, now + leaseMs, now, owner).changes > 0
  );
}
export function releaseWorker(owner: string) {
  sqlite().prepare("delete from worker_lease where owner=?").run(owner);
}
export function claimJob(owner: string) {
  return db().transaction(
    (tx) => {
      const lease = sqlite()
        .prepare("select owner,expires_at from worker_lease where id=1")
        .get() as { owner: string; expires_at: number } | undefined;
      if (lease?.owner !== owner || lease.expires_at <= Date.now())
        throw new Error("Worker lease expired");
      const next = tx
        .select()
        .from(jobs)
        .where(eq(jobs.status, "queued"))
        .orderBy(jobs.created_at, jobs.id)
        .get();
      if (!next) return;
      return tx
        .update(jobs)
        .set({ status: "running", updated_at: new Date().toISOString() })
        .where(eq(jobs.id, next.id))
        .returning()
        .get();
    },
    { behavior: "immediate" },
  );
}
export async function recoverJobs() {
  for (const job of db()
    .select()
    .from(jobs)
    .where(eq(jobs.status, "running"))
    .all()) {
    if (job.kind === "generate_image") {
      let reply;
      try {
        reply = await savedReply(job.id);
      } catch {
        /* Never resend corrupt saved responses. */
      }
      if (!reply && job.result?.sent) {
        finishJob(job.id, "uncertain", {
          error: "Worker 中断，模型调用结果未知；未自动重新请求。",
        });
        logJob(job.id, "interrupted", "调用结果未知，请检查后决定是否重新生成");
        continue;
      }
    }
    if (job.kind === "translate") {
      finishJob(job.id, "uncertain", {
        error: "翻译被中断，目标草稿未写入。请检查后手动重试。",
      });
      continue;
    }
    if (job.kind === "push_store") {
      finishJob(job.id, "uncertain", {
        error: "推送中断，请先同步商店资料核对已写入的内容。",
      });
      continue;
    }
    if (job.kind === "pull_google") {
      const message = "同步中断，请检查临时 edit 后重新同步。";
      finishJob(job.id, "uncertain", { error: message });
      logJob(job.id, "interrupted", message);
      continue;
    }
    if (job.kind === "verify_connection" && job.input.verifyApplication) {
      const message =
        "权限验证中断，请先检查 Google 临时 edit 状态，再手动验证。";
      db().transaction((tx) => {
        finishJob(job.id, "uncertain", { error: message });
        const target = `google:${job.input.appId}`;
        const config = tx
          .select()
          .from(connectionConfigs)
          .where(eq(connectionConfigs.id, target))
          .get();
        if (
          config?.verification?.jobId === job.id &&
          config.revision === job.input.revision
        ) {
          tx.update(connectionConfigs)
            .set({
              verification: {
                ...config.verification,
                status: "uncertain",
                message,
              },
            })
            .where(eq(connectionConfigs.id, target))
            .run();
        }
      });
      continue;
    }
    finishJob(job.id, "queued", {});
  }
}
export async function runWorker(
  execute: (job: typeof jobs.$inferSelect) => Promise<void>,
  signal: AbortSignal,
) {
  const owner = randomUUID();
  if (!acquireWorker(owner))
    throw new Error(
      "已有 Worker 运行，或上个 Worker 的租约尚未过期（最多 30 秒）",
    );
  let lost = false;
  const heartbeat = setInterval(() => {
    try {
      if (!acquireWorker(owner)) lost = true;
    } catch {
      lost = true;
    }
  }, 5000);
  try {
    await recoverJobs();
    while (!signal.aborted && !lost) {
      const job = claimJob(owner);
      if (job) await workerContext.run(owner, () => execute(job));
      else await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (lost) throw new Error("Worker 租约失效，停止领取任务");
  } finally {
    clearInterval(heartbeat);
    releaseWorker(owner);
  }
}
