import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { jobs, type Job } from "./schema";
import { HttpError } from "./http";
import { finishJob, logJob } from "./job-store";
import {
  resolutionLabel,
  type ImageReview,
  type Resolution,
} from "./image-resolution";

export function pendingImage(job: Job) {
  return job.result?.review as ImageReview | undefined;
}
export function pauseImage(
  job: Job,
  info: Resolution,
  url: string,
  item: string,
  values?: Record<string, string>,
  sample = false,
) {
  const review: ImageReview = {
    ...info,
    url,
    item,
    sample,
    token: randomUUID(),
  };
  finishJob(job.id, "paused", {
    review,
    values,
    url,
    error: sample
      ? "首张样图待确认，同批后续调用已暂停。"
      : "图片尺寸需要确认。同批后续调用已暂停。",
  });
  logJob(job.id, "review", resolutionLabel(info));
}
export function reviewDecision(
  id: string,
  token: string,
  decision: "accept" | "enhance" | "retry" | "cancel",
) {
  return db().transaction(
    (tx) => {
      const job = tx.select().from(jobs).where(eq(jobs.id, id)).get();
      if (!job || job.status !== "paused" || pendingImage(job)?.token !== token)
        throw new HttpError(409, "这张图片的处理状态已变化，请刷新记录");
      if (
        (decision === "accept" && !pendingImage(job)?.sample) ||
        (decision === "enhance" && pendingImage(job)?.sample)
      )
        throw new HttpError(409, "请选择当前样图支持的操作");
      if (decision === "cancel") {
        const batch = job.input.batchId ?? job.input.requestId;
        if (typeof batch === "string")
          tx.update(jobs)
            .set({ status: "cancelled", updated_at: new Date().toISOString() })
            .where(
              and(
                eq(jobs.kind, job.kind),
                eq(jobs.app_id, job.app_id),
                eq(jobs.status, "queued"),
                sql`coalesce(json_extract(${jobs.input},'$.batchId'),json_extract(${jobs.input},'$.requestId'))=${batch}`,
              ),
            )
            .run();
        finishJob(id, "cancelled", { ...job.result, error: "批次已停止" });
      } else
        finishJob(id, "queued", {
          ...job.result,
          decision,
          attempt: randomUUID(),
        });
      return id;
    },
    { behavior: "immediate" },
  );
}
