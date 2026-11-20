import { allScreenshots } from "./screenshot-groups";
import sharp from "sharp";
import { appSchema, validateDraft, platformSchema } from "./model";
import { assetPath } from "./storage";
import { generateImageTask } from "./image-task";
import { verifyConnectionTask } from "./connection-task";
import { pullAppleTask } from "./apple-sync-task";
import { finishJob, logJob } from "./job-store";
import type { Job } from "./schema";
export async function executeJob(job: Job) {
  try {
    switch (job.kind) {
      case "generate_image":
        return await generateImageTask(job);
      case "verify_connection":
        return await verifyConnectionTask(job);
      case "pull_apple":
        return await pullAppleTask(job);
      case "validate_draft": {
        const app = appSchema.parse(job.input);
        const platform = platformSchema.parse(job.platform);
        const errors: string[] = [];
        for (const [key, draft] of Object.entries(app.drafts).filter(([key]) =>
          key.startsWith(platform + ":"),
        )) {
          errors.push(
            ...validateDraft(platform, draft).map(
              (error) => `${key}: ${error}`,
            ),
          );
          for (const url of allScreenshots(draft)) {
            const meta = await sharp(
              assetPath(url.split("/").at(-1)!),
            ).metadata();
            if (!meta.width || !meta.height)
              errors.push(`${key}: 图片无法读取`);
          }
        }
        finishJob(job.id, "succeeded", {
          errors,
          note: "已校验字段长度与素材可读性，不代表商店完整校验通过。",
        });
        logJob(job.id, "complete", `校验完成，${errors.length} 个问题`);
      }
    }
  } catch {
    finishJob(job.id, "failed", {
      error: "任务失败，请检查配置和本机存储后重试。",
    });
    logJob(job.id, "failed", "任务执行失败");
  }
}
