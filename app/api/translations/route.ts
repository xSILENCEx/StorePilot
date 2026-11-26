import { readWorkspace } from "../../../lib/workspace-store";
import { draftLocales } from "../../../lib/store-locales";
import { activeJobStatuses } from "../../../lib/job-status";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { authorize, failure, HttpError, json } from "../../../lib/http";
import { db } from "../../../lib/db";
import { jobs } from "../../../lib/schema";
import { enqueue } from "../../../lib/job-store";
import { readConfig } from "../../../lib/config-store";
import { platformSchema } from "../../../lib/model";
import { translationItems } from "../../../lib/translation";
import { availableStoreLocales } from "../../../lib/store-locales";

const input = z.object({
  appId: z.uuid(),
  platform: platformSchema,
  mode: z.enum(["add", "update"]),
  source: z.string(),
  targets: z.array(z.string()).min(1).max(150),
  selected: z.array(z.string()).min(1),
  enhance: z.boolean().default(false),
  revision: z.number().int(),
});
export async function POST(request: Request) {
  try {
    await authorize(request);
    const {
      appId,
      platform,
      mode,
      source,
      targets,
      selected,
      revision,
      enhance,
    } = input.parse(await request.json());
    const configs = {
      text: await readConfig("text"),
      image: await readConfig("image"),
    };
    const ids = db().transaction(
      (tx) => {
        const row = readWorkspace(tx);
        const app = row?.apps.find((a) => a.id === appId);
        const draft = app?.drafts[platform + ":" + source];
        if (!app?.[platform] || !draft)
          throw new HttpError(404, "来源草稿不存在");
        if (row?.revision !== revision)
          throw new HttpError(409, "草稿已更新，请重新检查翻译选项");
        const existing = draftLocales(app, platform);
        const allowed =
          mode === "add"
            ? availableStoreLocales(platform, existing).map((l) => l.code)
            : existing;
        if (
          targets.some((t) => t === source || !allowed.includes(t)) ||
          new Set(targets).size !== targets.length
        )
          throw new HttpError(400, "目标语言选择无效");
        const items = translationItems(platform, draft).filter((i) =>
          selected.includes(i.id),
        );
        if (items.length !== selected.length)
          throw new HttpError(400, "来源内容已变更");
        for (const scope of ["text", "image"] as const) {
          if (
            items.some((i) =>
              scope === "text"
                ? i.kind === "text"
                : ["screenshot", "graphic"].includes(i.kind),
            ) &&
            !configs[scope].configured
          )
            throw new HttpError(
              400,
              scope === "text" ? "请先配置文字模型" : "请先配置图片模型",
            );
        }
        const pending = tx
          .select({ input: jobs.input })
          .from(jobs)
          .where(
            and(
              eq(jobs.app_id, appId),
              eq(jobs.platform, platform),
              eq(jobs.kind, "translate"),
              inArray(jobs.status, activeJobStatuses),
            ),
          )
          .all();
        if (pending.some((j) => targets.includes(String(j.input.target))))
          throw new HttpError(409, "目标语言已有翻译任务，请等待完成");
        return targets.map((target) =>
          enqueue(
            {
              app_id: appId,
              platform,
              kind: "translate",
              input: {
                enhance,
                source,
                target,
                items,
                identifier: app[platform],
                before: app.drafts[platform + ":" + target] ?? null,
                textRevision: configs.text.revision,
                imageRevision: configs.image.revision,
              },
            },
            tx,
          ),
        );
      },
      { behavior: "immediate" },
    );
    return json({ ids }, 202);
  } catch (e) {
    return failure(e);
  }
}
