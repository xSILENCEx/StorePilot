import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../lib/db";
import {
  jobs,
  workspaces,
  connectionConfigs,
  storeSnapshots,
} from "../../../lib/schema";
import { enqueue } from "../../../lib/job-store";
import { authorize, failure, HttpError, json } from "../../../lib/http";
import { configFields } from "../../../lib/config-model";
export async function GET(request: Request) {
  try {
    await authorize(request);
    const appId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("appId"));
    const snapshot = db()
      .select()
      .from(storeSnapshots)
      .where(eq(storeSnapshots.app_id, appId))
      .get();
    const config = db()
      .select()
      .from(connectionConfigs)
      .where(eq(connectionConfigs.id, `apple:${appId}`))
      .get();
    const job = db()
      .select({ id: jobs.id, status: jobs.status, result: jobs.result })
      .from(jobs)
      .where(and(eq(jobs.app_id, appId), eq(jobs.kind, "pull_apple")))
      .orderBy(desc(jobs.created_at))
      .get();
    return json({
      snapshot: snapshot?.current_snapshot ?? null,
      previous: snapshot?.previous_snapshot ?? null,
      stale: !!snapshot && snapshot.config_revision !== config?.revision,
      job: job ?? null,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    await authorize(request);
    const input = z
      .object({
        appId: z.uuid(),
        appInfoId: z.string().trim().max(200).default(""),
      })
      .strict()
      .parse(await request.json());
    const id = db().transaction(
      (tx) => {
        const app = tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, "default"))
          .get()
          ?.apps.find((a) => a.id === input.appId);
        if (!app?.apple) throw new HttpError(404, "Apple 应用不存在");
        const config = tx
          .select()
          .from(connectionConfigs)
          .where(eq(connectionConfigs.id, `apple:${input.appId}`))
          .get();
        if (!config?.secret)
          throw new HttpError(
            400,
            "尚未保存 Apple 连接凭据，请先在连接与模型中保存配置",
          );
        const parsed = configFields.apple.safeParse(config.fields);
        if (!parsed.success)
          throw new HttpError(
            400,
            "Apple 连接配置不完整，请检查应用 ID、Bundle ID 和平台",
          );
        if (parsed.data.bundleId !== app.apple)
          throw new HttpError(
            409,
            "Apple 连接的 Bundle ID 与当前应用不一致，请检查连接配置",
          );
        if (
          tx
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.app_id, input.appId),
                eq(jobs.kind, "pull_apple"),
                inArray(jobs.status, ["queued", "running"]),
              ),
            )
            .get()
        )
          throw new HttpError(409, "已有商店资料同步任务，请等待完成");
        return enqueue(
          {
            app_id: input.appId,
            platform: "apple",
            kind: "pull_apple",
            input: {
              configRevision: config.revision,
              appInfoId: input.appInfoId,
            },
          },
          tx,
        );
      },
      { behavior: "immediate" },
    );
    return json({ id }, 202);
  } catch (e) {
    return failure(e);
  }
}
