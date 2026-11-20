import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../../lib/db";
import {
  assets,
  connectionConfigs,
  jobs,
  workspaces,
} from "../../../lib/schema";
import { imageRequest, imageHistoryQuery } from "../../../lib/image-model";
import { authorize, failure, HttpError, json } from "../../../lib/http";
export async function GET(request: Request) {
  try {
    await authorize(request);
    const target = imageHistoryQuery.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const records = db()
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.app_id, target.appId),
          eq(jobs.platform, target.platform),
          eq(jobs.kind, "generate_image"),
          sql`json_extract(${jobs.input}, '$.locale') = ${target.locale}`,
          target.deviceGroup
            ? sql`json_extract(${jobs.input}, '$.deviceGroup') = ${target.deviceGroup}`
            : undefined,
          target.modelSize
            ? sql`json_extract(${jobs.input}, '$.settings.modelSize') = ${target.modelSize}`
            : undefined,
        ),
      )
      .orderBy(desc(jobs.created_at))
      .all();
    return json({
      images: records.map(({ id, status, input, result, created_at }) => ({
        id,
        status,
        input,
        result,
        created_at,
      })),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    await authorize(request);
    const input = imageRequest.parse(await request.json());
    const id = db().transaction(
      (tx) => {
        const existing = tx
          .select()
          .from(jobs)
          .where(
            or(
              eq(jobs.id, input.requestId),
              and(
                eq(jobs.kind, "generate_image"),
                sql`json_extract(${jobs.input}, '$.requestId') = ${input.requestId}`,
              ),
            ),
          )
          .get();
        if (existing) {
          const {
            configRevision: _revision,
            screenshotIndex: _index,
            ...original
          } = existing.input;
          if (
            existing.kind !== "generate_image" ||
            JSON.stringify(original) !== JSON.stringify(input)
          )
            throw new HttpError(409, "请求 ID 已被使用，请重新发起生成");
          return input.requestId;
        }
        const app = tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, "default"))
          .get()
          ?.apps.find((a) => a.id === input.appId);
        if (
          !app?.[input.platform] ||
          !app.drafts[`${input.platform}:${input.locale}`]
        )
          throw new HttpError(404, "应用、平台或语言不存在");
        const config = tx
          .select()
          .from(connectionConfigs)
          .where(eq(connectionConfigs.id, "image:global"))
          .get();
        if (!config?.secret)
          throw new HttpError(400, "请先在设置中配置图像 API");
        const refs = [
          ...new Set(
            [...(input.screenshots ?? []), ...input.settings.references].map(
              (url) => url.split("/").at(-1)!,
            ),
          ),
        ];
        if (
          refs.length &&
          tx.select().from(assets).where(inArray(assets.id, refs)).all()
            .length !== refs.length
        )
          throw new HttpError(400, "截图或素材不存在");
        const active = tx
          .select({ input: jobs.input })
          .from(jobs)
          .where(
            and(
              eq(jobs.kind, "generate_image"),
              inArray(jobs.status, ["queued", "running"]),
            ),
          )
          .all();
        if (new Set(active.map((job) => job.input.requestId)).size >= 4)
          throw new HttpError(409, "已有四批图片任务，请等待完成");
        const count = input.screenshots?.length ?? 1;
        for (let index = 0; index < count; index++) {
          tx.insert(jobs)
            .values({
              id: index === 0 ? input.requestId : randomUUID(),
              app_id: input.appId,
              platform: input.platform,
              kind: "generate_image",
              input: {
                ...input,
                ...(input.screenshots && { screenshotIndex: index }),
                configRevision: config.revision,
              },
            })
            .run();
        }
        return input.requestId;
      },
      { behavior: "immediate" },
    );
    return json({ id }, 202);
  } catch (e) {
    return failure(e);
  }
}
