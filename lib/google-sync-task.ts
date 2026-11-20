import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  connectionConfigs,
  googleSnapshots,
  workspaces,
  type Job,
} from "./schema";
import { workerConfig } from "./config-store";
import { saveStoreScreenshots, StoreSyncError } from "./store-assets";
import { finishJob, logJob } from "./job-store";
import { readGoogleSnapshot } from "./google-sync";
import { CheckError } from "./connection-check";
export async function pullGoogleTask(
  job: Job,
  download?: Parameters<typeof saveStoreScreenshots>[2],
) {
  const input = z.object({ configRevision: z.number() }).parse(job.input);
  try {
    logJob(
      job.id,
      "read",
      "读取 Google Play 商店元数据与截图，不修改商店或草稿",
    );
    const config = await workerConfig("google", job.app_id);
    if (config.revision !== input.configRevision)
      throw new StoreSyncError("配置已变更，请重新拉取。");
    const snapshot = await readGoogleSnapshot(config, fetch, (step, message) =>
      logJob(job.id, step, message),
    );
    const oldSnapshot = db()
      .select()
      .from(googleSnapshots)
      .where(eq(googleSnapshots.app_id, job.app_id))
      .get()?.current_snapshot;
    logJob(job.id, "images", "下载并保存各语言、设备的商店截图");
    const screenshotCount = await saveStoreScreenshots(
      snapshot,
      oldSnapshot,
      download,
    );
    db().transaction(
      (tx) => {
        const current = tx
          .select()
          .from(connectionConfigs)
          .where(eq(connectionConfigs.id, `google:${job.app_id}`))
          .get();
        if (current?.revision !== config.revision)
          throw new StoreSyncError("拉取期间配置已变更，未更新快照。");
        const app = tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, "default"))
          .get()
          ?.apps.find((a) => a.id === job.app_id);
        if (app?.google !== snapshot.packageName)
          throw new StoreSyncError("Google 应用包名已变更，未更新快照。");
        const old = tx
          .select()
          .from(googleSnapshots)
          .where(eq(googleSnapshots.app_id, job.app_id))
          .get();
        const value = {
          app_id: job.app_id,
          config_revision: config.revision,
          current_snapshot: snapshot,
          previous_snapshot:
            old?.current_snapshot.packageName === snapshot.packageName
              ? (old?.current_snapshot ?? null)
              : null,
          updated_at: new Date().toISOString(),
        };
        tx.insert(googleSnapshots)
          .values(value)
          .onConflictDoUpdate({ target: googleSnapshots.app_id, set: value })
          .run();
        finishJob(job.id, "succeeded", {
          message: `已同步 ${Object.keys(snapshot.locales).length} 种语言的元数据和 ${screenshotCount} 张截图，草稿未改变`,
          packageName: snapshot.packageName,
          screenshotCount,
          warnings: snapshot.warnings,
        });
        logJob(job.id, "complete", "商店资料快照已保存");
      },
      { behavior: "immediate" },
    );
  } catch (error) {
    const message =
      error instanceof CheckError
        ? ({
            google_auth: "Google OAuth 鉴权：",
            google_edit: "创建 Google Play 临时 edit：",
          }[error.step] ?? "") + error.message
        : error instanceof StoreSyncError
          ? error.message
          : "Google Play 商店资料同步失败，请检查配置或响应格式。";
    finishJob(job.id, "failed", {
      error: message,
      ...(error instanceof CheckError ? { step: error.step } : {}),
    });
    logJob(job.id, "failed", message);
  }
}
