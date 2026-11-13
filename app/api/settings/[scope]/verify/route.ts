import { z } from "zod";
import { eq } from "drizzle-orm";
import { configTarget as target } from "../../../../../lib/config-target";
import { failure, HttpError, json } from "../../../../../lib/http";
import { configId } from "../../../../../lib/config-store";
import { db } from "../../../../../lib/db";
import { connectionConfigs, jobs } from "../../../../../lib/schema";
import { enqueue } from "../../../../../lib/job-store";
export async function POST(
  request: Request,
  context: { params: Promise<{ scope: string }> },
) {
  try {
    const { scope, appId } = await target(request, context);
    const input = z
      .object({
        revision: z.number().int().positive(),
        verifyApplication: z.boolean().optional(),
      })
      .strict()
      .parse(await request.json());
    if (input.verifyApplication && scope !== "google")
      throw new HttpError(400, "仅 Google 支持应用权限验证");
    const id = db().transaction(
      (tx) => {
        const targetId = configId(scope, appId);
        const config = tx
          .select()
          .from(connectionConfigs)
          .where(eq(connectionConfigs.id, targetId))
          .get();
        if (!config?.secret) throw new HttpError(400, "请先保存连接配置");
        if (config.revision !== input.revision)
          throw new HttpError(409, "配置已变更，请重新载入后验证");
        if (config.verification) {
          const existing = tx
            .select()
            .from(jobs)
            .where(eq(jobs.id, config.verification.jobId))
            .get();
          if (existing && ["queued", "running"].includes(existing.status))
            return existing.id;
        }
        const id = enqueue(
          {
            app_id: appId ?? "workspace",
            platform: scope,
            kind: "verify_connection",
            input: {
              scope,
              appId,
              revision: input.revision,
              verifyApplication: input.verifyApplication ?? false,
            },
          },
          tx,
        );
        tx.update(connectionConfigs)
          .set({
            verification: {
              status: "queued",
              revision: input.revision,
              jobId: id,
              message: "验证任务已入队",
            },
          })
          .where(eq(connectionConfigs.id, targetId))
          .run();
        return id;
      },
      { behavior: "immediate" },
    );
    return json({ id }, 202);
  } catch (e) {
    return failure(e);
  }
}
