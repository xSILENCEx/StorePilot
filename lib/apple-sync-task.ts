import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  connectionConfigs,
  storeSnapshots,
  workspaces,
  type Job,
} from "./schema";
import { workerConfig } from "./config-store";
import { AppleReadError, readAppleSnapshot } from "./apple-sync";
import { saveAppleScreenshots } from "./apple-assets";
import { finishJob, logJob } from "./job-store";
export async function pullAppleTask(
  job: Job,
  download?: Parameters<typeof saveAppleScreenshots>[2],
) {
  const input = z
    .object({ configRevision: z.number(), appInfoId: z.string() })
    .parse(job.input);
  try {
    logJob(job.id, "read", "读取 Apple 商店元数据与截图，不修改商店或草稿");
    const config = await workerConfig("apple", job.app_id);
    if (config.revision !== input.configRevision)
      throw new AppleReadError("配置已变更，请重新拉取。");
    const snapshot = await readAppleSnapshot(config, input.appInfoId);
    const oldSnapshot = db()
      .select()
      .from(storeSnapshots)
      .where(eq(storeSnapshots.app_id, job.app_id))
      .get()?.current_snapshot;
    logJob(job.id, "images", "下载并保存各语言、设备的商店截图");
    const screenshotCount = await saveAppleScreenshots(
      snapshot,
      oldSnapshot,
      download,
    );
    db().transaction(
      (tx) => {
        const current = tx
          .select()
          .from(connectionConfigs)
          .where(eq(connectionConfigs.id, `apple:${job.app_id}`))
          .get();
        if (current?.revision !== config.revision)
          throw new AppleReadError("拉取期间配置已变更，未更新快照。");
        const app = tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, "default"))
          .get()
          ?.apps.find((a) => a.id === job.app_id);
        if (!app?.apple)
          throw new AppleReadError("Apple 应用已移除，未更新快照。");
        const old = tx
          .select()
          .from(storeSnapshots)
          .where(eq(storeSnapshots.app_id, job.app_id))
          .get();
        const value = {
          app_id: job.app_id,
          config_revision: config.revision,
          current_snapshot: snapshot,
          previous_snapshot:
            old?.current_snapshot.target.versionId ===
              snapshot.target.versionId &&
            old?.current_snapshot.target.appInfoId === snapshot.target.appInfoId
              ? (old?.current_snapshot ?? null)
              : null,
          updated_at: new Date().toISOString(),
        };
        tx.insert(storeSnapshots)
          .values(value)
          .onConflictDoUpdate({ target: storeSnapshots.app_id, set: value })
          .run();
        finishJob(job.id, "succeeded", {
          message: `已同步 ${Object.keys(snapshot.locales).length} 种语言的元数据和 ${screenshotCount} 张截图，草稿未改变`,
          target: snapshot.target,
          screenshotCount,
          warnings: snapshot.warnings,
        });
        logJob(job.id, "complete", "商店资料快照已保存");
      },
      { behavior: "immediate" },
    );
  } catch (error) {
    const message =
      error instanceof AppleReadError
        ? error.message
        : "Apple 商店资料同步失败，请检查配置或响应格式。";
    finishJob(job.id, "failed", { error: message });
    logJob(job.id, "failed", message);
  }
}
