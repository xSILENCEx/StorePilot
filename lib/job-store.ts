import { assertWorkerActive } from "./worker-context";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { jobs, jobLogs, type Job } from "./schema";
export function enqueue(
  value: Pick<Job, "app_id" | "platform" | "kind" | "input">,
  tx: Pick<ReturnType<typeof db>, "insert"> = db(),
) {
  const id = randomUUID();
  tx.insert(jobs)
    .values({ ...value, id })
    .run();
  return id;
}
export function logJob(id: string, step: string, message: string) {
  assertWorkerActive();
  db().insert(jobLogs).values({ job_id: id, step, message }).run();
}
export function finishJob(
  id: string,
  status: Job["status"],
  result: Record<string, unknown>,
) {
  assertWorkerActive();
  db()
    .update(jobs)
    .set({ status, result, updated_at: new Date().toISOString() })
    .where(eq(jobs.id, id))
    .run();
}
