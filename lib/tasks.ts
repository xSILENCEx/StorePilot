import { generateImageTask } from "./image-task";
import type { TaskList } from "graphile-worker";
import { pool } from "./db";
import { validateDraft, type StoreApp, type Platform } from "./model";
import { assetPath } from "./storage";
import sharp from "sharp";
import { verifyConnectionTask } from "./connection-task";
export const taskList: TaskList = {
  generate_image: generateImageTask,
  verify_connection: verifyConnectionTask,
  validate_draft: async (payload, helpers) => {
    const { id } = payload as { id: string };
    const client = await pool().connect();
    try {
      const {
        rows: [job],
      } = await client.query("select * from jobs where id=$1", [id]);
      if (!job || job.status === "succeeded") return;
      await client.query(
        "update jobs set status='running', updated_at=now() where id=$1",
        [id],
      );
      await client.query(
        "insert into job_logs(job_id,step,message) values($1,$2,$3)",
        [id, "validate", "开始校验冻结草稿"],
      );
      const app = job.input as StoreApp;
      const errors: string[] = [];
      for (const [key, draft] of Object.entries(app.drafts).filter(([key]) =>
        key.startsWith(job.platform + ":"),
      )) {
        errors.push(
          ...validateDraft(job.platform as Platform, draft).map(
            (e) => `${key}: ${e}`,
          ),
        );
        for (const url of draft.images) {
          const meta = await sharp(
            assetPath(url.split("/").at(-1)!),
          ).metadata();
          if (!meta.width || !meta.height) errors.push(`${key}: 图片无法读取`);
        }
      }
      const result = {
        errors,
        note: "已校验字段长度与素材可读性。设备尺寸、商店版本状态与必填项需在商店适配阶段校验；此结果不表示允许推送。",
      };
      await client.query("begin");
      await client.query(
        "update jobs set status='succeeded', result=$2, updated_at=now() where id=$1",
        [id, result],
      );
      await client.query(
        "insert into job_logs(job_id,step,message) values($1,$2,$3)",
        [id, "complete", `校验完成，${errors.length} 个字段问题`],
      );
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      await client.query(
        "update jobs set status=$3, result=$2, updated_at=now() where id=$1",
        [
          id,
          { error: "校验失败：请检查素材文件及数据库后重试" },
          helpers.job.attempts < helpers.job.max_attempts
            ? "retrying"
            : "failed",
        ],
      );
      await client.query(
        "insert into job_logs(job_id,step,message) values($1,$2,$3)",
        [id, "failed", "素材读取或数据库操作失败，任务将按队列策略重试"],
      );
      throw e;
    } finally {
      client.release();
    }
  },
};
