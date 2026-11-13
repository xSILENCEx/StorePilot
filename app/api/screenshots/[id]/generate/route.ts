import { z } from "zod";
import { authorize, failure, HttpError, json } from "../../../../../lib/http";
import {
  getGroup,
  assertGroupApp,
  assertAssets,
} from "../../../../../lib/screenshot-store";
import { validateGeneration } from "../../../../../lib/screenshot-model";
import { configFields } from "../../../../../lib/config-model";
import { pool } from "../../../../../lib/db";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let client;
  try {
    await authorize(request);
    const { id } = await context.params;
    z.uuid().parse(id);
    const input = z
      .object({
        revision: z.number().int().positive(),
        requestId: z.uuid(),
        reuseCandidateId: z.uuid().optional(),
      })
      .strict()
      .parse(await request.json());
    const group = await getGroup(id);
    await assertGroupApp(group);
    const error = validateGeneration(group.settings);
    if (error && !input.reuseCandidateId) throw new HttpError(400, error);
    if (
      input.reuseCandidateId &&
      group.settings.mode !== "image-ai" &&
      !group.settings.screenshot
    )
      throw new HttpError(400, "模板需要真实 App 截图");
    await assertAssets([group.settings.screenshot, group.settings.art]);
    client = await pool().connect();
    await client.query("begin");
    const {
      rows: [locked],
    } = await client.query(
      "select revision from screenshot_groups where id=$1 for update",
      [id],
    );
    const {
      rows: [existing],
    } = await client.query(
      "select id,job_id from image_candidates where group_id=$1 and request_id=$2",
      [id, input.requestId],
    );
    if (existing) {
      await client.query("commit");
      return json(existing, 202);
    }
    if (
      locked.revision !== input.revision ||
      locked.revision !== group.revision
    )
      throw new HttpError(409, "配置已修改，请重新载入截图组后再生成");
    const {
      rows: [count],
    } = await client.query(
      "select count(*)::int as n from image_candidates where group_id=$1 and status in ('queued','running')",
      [id],
    );
    if (count.n >= 4)
      throw new HttpError(429, "当前截图组最多同时排队 4 个候选");
    let sourceRawUrl: string | null = null;
    if (input.reuseCandidateId) {
      const {
        rows: [source],
      } = await client.query(
        "select raw_url from image_candidates where id=$1 and group_id=$2 and status in ('succeeded','failed','uncertain')",
        [input.reuseCandidateId, id],
      );
      if (!source?.raw_url)
        throw new HttpError(400, "候选没有可复用的 AI 原图");
      sourceRawUrl = source.raw_url;
    }
    let configRevision: number | null = null;
    let concurrency = 1;
    let modelConfig: ReturnType<typeof configFields.image.parse> | null = null;
    if (group.settings.mode !== "template" && !sourceRawUrl) {
      const {
        rows: [config],
      } = await client.query(
        "select revision,fields,secret from connection_configs where id='image:global'",
      );
      if (!config?.secret)
        throw new HttpError(400, "请先在设置页面保存图像模型配置");
      const fields = configFields.image.parse(config.fields);
      modelConfig = fields;
      configRevision = config.revision;
      concurrency = fields.concurrency;
    }
    const candidateId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await client.query(
      "insert into jobs(id,app_id,platform,kind,input) values($1,$2,$3,'generate_image',$4)",
      [
        jobId,
        group.app_id,
        group.platform,
        {
          candidateId,
          configRevision,
          modelConfig,
          reuseCandidateId: input.reuseCandidateId ?? null,
          sourceRawUrl,
          locale: group.locale,
          device: group.device,
        },
      ],
    );
    await client.query(
      "insert into image_candidates(id,group_id,job_id,request_id,settings,origin) values($1,$2,$3,$4,$5,$6)",
      [
        candidateId,
        id,
        jobId,
        input.requestId,
        group.settings,
        group.settings.mode,
      ],
    );
    const {
      rows: [slot],
    } = await client.query(
      "select mod(nextval('image_generation_slot'),$1)::int as n",
      [concurrency],
    );
    await client.query(
      "select graphile_worker.add_job('generate_image',$1::json,queue_name := $2,max_attempts := 3)",
      [JSON.stringify({ id: jobId }), `image:${slot.n}`],
    );
    await client.query("commit");
    return json({ id: candidateId, job_id: jobId }, 202);
  } catch (e) {
    if (client) await client.query("rollback");
    return failure(e);
  } finally {
    client?.release();
  }
}
