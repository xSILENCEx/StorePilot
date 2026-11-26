import { saveStoreSnapshot } from "./store-snapshot";
import { z } from "zod";
import { type Job } from "./schema";
import { workerConfig } from "./config-store";
import { AppleReadError, readAppleSnapshot } from "./apple-sync";
import { saveStoreImages, StoreSyncError } from "./store-assets";
import { finishJob, logJob } from "./job-store";
export async function pullAppleTask(
  job: Job,
  download?: Parameters<typeof saveStoreImages>[2],
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
    await saveStoreSnapshot(job, config.revision, snapshot, download);
  } catch (error) {
    const message =
      error instanceof AppleReadError || error instanceof StoreSyncError
        ? error.message
        : "Apple 商店资料同步失败，请检查配置或响应格式。";
    finishJob(job.id, "failed", { error: message });
    logJob(job.id, "failed", message);
  }
}
