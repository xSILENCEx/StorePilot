import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../lib/db";
import { jobs, workspaces, connectionConfigs } from "../../../lib/schema";
import { authorize, failure, HttpError, json } from "../../../lib/http";
import { platformSchema } from "../../../lib/model";
import { pushContent, pushSections } from "../../../lib/push-plan";
import { configFields } from "../../../lib/config-model";
const input = z.object({
  requestId: z.uuid(),
  appId: z.uuid(),
  platform: platformSchema,
  revision: z.number().int(),
  locales: z.array(z.string()).min(1),
  sections: pushSections,
});
export async function POST(request: Request) {
  try {
    await authorize(request);
    const { requestId, appId, platform, revision, locales, sections } =
      input.parse(await request.json());
    const selection = JSON.stringify([
      revision,
      [...new Set(locales)].sort(),
      [...new Set(sections)].sort(),
    ]);
    db().transaction(
      (tx) => {
        const previous = tx
          .select()
          .from(jobs)
          .where(eq(jobs.id, requestId))
          .get();
        if (previous) {
          if (
            previous.kind === "push_store" &&
            previous.app_id === appId &&
            previous.platform === platform &&
            previous.input.selection === selection
          )
            return;
          throw new HttpError(409, "请求编号冲突");
        }
        const row = tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, "default"))
          .get();
        const app = row?.apps.find((a) => a.id === appId);
        if (!app?.[platform]) throw new HttpError(404, "应用或平台不存在");
        if (revision !== row?.revision)
          throw new HttpError(409, "草稿已变化，请重新打开推送窗口");
        const config = tx
          .select()
          .from(connectionConfigs)
          .where(eq(connectionConfigs.id, platform + ":" + appId))
          .get();
        if (!config?.secret) throw new HttpError(400, "请先配置商店连接");
        const fields = configFields[platform].parse(config.fields);
        if (
          ("bundleId" in fields ? fields.bundleId : fields.packageName) !==
          app[platform]
        )
          throw new HttpError(409, "商店连接与应用标识不一致");
        if (
          tx
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.app_id, appId),
                eq(jobs.platform, platform),
                eq(jobs.kind, "push_store"),
                inArray(jobs.status, ["queued", "running"]),
              ),
            )
            .get()
        )
          throw new HttpError(409, "已有推送任务正在进行");
        const entries = Array.from(new Set(locales)).map((locale) => {
          const draft = app.drafts[platform + ":" + locale];
          if (!draft) throw new HttpError(400, "目标语言没有草稿");
          const content = pushContent(platform, draft, sections);
          if (content.errors.length)
            throw new HttpError(400, locale + "：" + content.errors.join("；"));
          return { locale, ...content };
        });
        tx.insert(jobs)
          .values({
            id: requestId,
            kind: "push_store",
            platform,
            app_id: appId,
            input: {
              selection,
              entries,
              identifier: app[platform],
              configRevision: config.revision,
            },
          })
          .run();
      },
      { behavior: "immediate" },
    );
    return json({ id: requestId }, 202);
  } catch (e) {
    return failure(e);
  }
}
