import { assertWorkerActive } from "./worker-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { connectionConfigs, type Job } from "./schema";
import { configId, workerConfig } from "./config-store";
import { checkConnection, type CheckResult } from "./connection-check";
import { configScope } from "./config-model";
import { finishJob, logJob } from "./job-store";
export async function verifyConnectionTask(job: Job) {
  const { scope, appId, revision, verifyApplication } = z
    .object({
      scope: configScope,
      appId: z.string().optional(),
      revision: z.number(),
      verifyApplication: z.boolean(),
    })
    .parse(job.input);
  const target = configId(scope, appId);
  let result: CheckResult;
  try {
    const config = await workerConfig(scope, appId);
    if (config.revision !== revision) throw new Error("stale");
    result = await checkConnection(
      scope,
      config,
      { verifyApplication },
      async (input, init) => {
        assertWorkerActive();
        return fetch(input, init);
      },
      async (step, message) => {
        logJob(job.id, step, message);
      },
    );
  } catch {
    result = {
      status: "failed",
      message: "配置已变更、被清除或无法解密，请重新载入配置后验证。",
      checkedAt: new Date().toISOString(),
      steps: [],
    };
  }
  db().transaction((tx) => {
    const current = tx
      .select()
      .from(connectionConfigs)
      .where(eq(connectionConfigs.id, target))
      .get();
    if (current?.verification?.jobId === job.id)
      tx.update(connectionConfigs)
        .set({ verification: { ...result, revision, jobId: job.id } })
        .where(
          and(
            eq(connectionConfigs.id, target),
            eq(connectionConfigs.revision, revision),
          ),
        )
        .run();
    finishJob(
      job.id,
      result.status === "failed" ? "failed" : "succeeded",
      result,
    );
    logJob(job.id, "complete", result.message);
  });
}
