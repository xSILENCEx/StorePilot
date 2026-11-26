import { eq } from "drizzle-orm";
import { db } from "./db";
import { configId } from "./config-store";
import { finishJob, logJob } from "./job-store";
import {
  storeSnapshots,
  googleSnapshots,
  connectionConfigs,
  type Job,
} from "./schema";
import { saveStoreImages, StoreSyncError } from "./store-assets";
import {
  snapshotIdentity,
  type AppleSnapshot,
  type GoogleSnapshot,
} from "./apple-sync-model";
import { findWorkspaceApp } from "./workspace-store";
export async function saveStoreSnapshot(
  job: Job,
  revision: number,
  snapshot: AppleSnapshot | GoogleSnapshot,
  download?: Parameters<typeof saveStoreImages>[2],
) {
  const google = "packageName" in snapshot;
  const platform = google ? "google" : "apple";
  const table = google ? googleSnapshots : storeSnapshots;
  const previous = db()
    .select()
    .from(table)
    .where(eq(table.app_id, job.app_id))
    .get()?.current_snapshot;
  logJob(job.id, "images", "下载并保存各语言、设备的商店截图");
  const screenshotCount = await saveStoreImages(snapshot, previous, download);
  db().transaction(
    (tx) => {
      const config = tx
        .select()
        .from(connectionConfigs)
        .where(eq(connectionConfigs.id, configId(platform, job.app_id)))
        .get();
      if (config?.revision !== revision)
        throw new StoreSyncError("拉取期间配置已变更，未更新快照。");
      const app = findWorkspaceApp(job.app_id, tx);
      if (app?.[platform] !== snapshotIdentity(snapshot).identifier)
        throw new StoreSyncError("商店应用标识已变更，未更新快照。");
      const row = {
        app_id: job.app_id,
        config_revision: revision,
        updated_at: new Date().toISOString(),
      };
      if (google) {
        const value = { ...row, current_snapshot: snapshot };
        tx.insert(googleSnapshots)
          .values(value)
          .onConflictDoUpdate({ target: googleSnapshots.app_id, set: value })
          .run();
      } else {
        const value = { ...row, current_snapshot: snapshot };
        tx.insert(storeSnapshots)
          .values(value)
          .onConflictDoUpdate({ target: storeSnapshots.app_id, set: value })
          .run();
      }
      finishJob(job.id, "succeeded", {
        message: `已同步 ${Object.keys(snapshot.locales).length} 种语言的元数据和 ${screenshotCount} 张截图，草稿未改变`,
        ...(google
          ? { packageName: snapshot.packageName }
          : { target: snapshot.target }),
        screenshotCount,
        warnings: snapshot.warnings,
      });
      logJob(job.id, "complete", "商店资料快照已保存");
    },
    { behavior: "immediate" },
  );
}
