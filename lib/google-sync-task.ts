import { saveStoreSnapshot } from "./store-snapshot";
import { z } from "zod";
import { type Job } from "./schema";
import { workerConfig } from "./config-store";
import { saveStoreImages, StoreSyncError } from "./store-assets";
import { finishJob, logJob } from "./job-store";
import { readGoogleSnapshot } from "./google-sync";
import { CheckError } from "./connection-check";
export async function pullGoogleTask(
  job: Job,
  download?: Parameters<typeof saveStoreImages>[2],
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
    await saveStoreSnapshot(job, config.revision, snapshot, download);
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
