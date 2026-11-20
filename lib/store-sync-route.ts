import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  jobs,
  workspaces,
  connectionConfigs,
  storeSnapshots,
  googleSnapshots,
} from "./schema";
import { enqueue } from "./job-store";
import { authorize, failure, HttpError, json } from "./http";
import { configFields } from "./config-model";
export async function getStoreSync(
  request: Request,
  platform: "apple" | "google",
) {
  try {
    await authorize(request);
    const appId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("appId"));
    const table = platform === "apple" ? storeSnapshots : googleSnapshots;
    const snapshot = db()
      .select()
      .from(table)
      .where(eq(table.app_id, appId))
      .get();
    const config = db()
      .select()
      .from(connectionConfigs)
      .where(eq(connectionConfigs.id, `${platform}:${appId}`))
      .get();
    const job = db()
      .select({ id: jobs.id, status: jobs.status, result: jobs.result })
      .from(jobs)
      .where(and(eq(jobs.app_id, appId), eq(jobs.kind, `pull_${platform}`)))
      .orderBy(desc(jobs.created_at))
      .get();
    return json({
      snapshot: snapshot?.current_snapshot ?? null,
      stale: !!snapshot && snapshot.config_revision !== config?.revision,
      job: job ?? null,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function queueStoreSync(
  request: Request,
  platform: "apple" | "google",
) {
  try {
    await authorize(request);
    const input = z
      .object({
        appId: z.uuid(),
        appInfoId: z.string().trim().max(200).default(""),
      })
      .strict()
      .parse(await request.json());
    const id = enqueueStoreSync(platform, input);
    return json({ id }, 202);
  } catch (e) {
    return failure(e);
  }
}

export function enqueueStoreSync(
  platform: "apple" | "google",
  input: { appId: string; appInfoId: string },
) {
  return db().transaction(
    (tx) => {
      const app = tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, "default"))
        .get()
        ?.apps.find((a) => a.id === input.appId);
      if (!app?.[platform]) throw new HttpError(404, "当前平台应用不存在");
      const config = tx
        .select()
        .from(connectionConfigs)
        .where(eq(connectionConfigs.id, `${platform}:${input.appId}`))
        .get();
      if (!config?.secret)
        throw new HttpError(
          400,
          "尚未保存商店连接凭据，请先在连接与模型中保存配置",
        );
      const parsed = configFields[platform].safeParse(config.fields);
      if (!parsed.success) throw new HttpError(400, "商店连接配置不完整");
      const identifier =
        "bundleId" in parsed.data
          ? parsed.data.bundleId
          : parsed.data.packageName;
      if (identifier !== app[platform])
        throw new HttpError(409, "连接配置的应用标识与当前应用不一致");
      if (
        tx
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.app_id, input.appId),
              eq(jobs.kind, `pull_${platform}`),
              inArray(jobs.status, ["queued", "running"]),
            ),
          )
          .get()
      )
        throw new HttpError(409, "已有商店资料同步任务，请等待完成");
      return enqueue(
        {
          app_id: input.appId,
          platform,
          kind: `pull_${platform}`,
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
}
