import { z } from "zod";
import { pool } from "../../../lib/db";
import { authorize, failure, HttpError, json } from "../../../lib/http";
import { configFields } from "../../../lib/config-model";
export async function GET(request: Request) {
  try {
    await authorize(request);
    const appId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("appId"));
    const {
      rows: [snapshot],
    } = await pool().query(
      "select s.*,c.revision as live_revision from store_snapshots s left join connection_configs c on c.id=$2 where s.app_id=$1",
      [appId, `apple:${appId}`],
    );
    const {
      rows: [job],
    } = await pool().query(
      "select id,status,result from jobs where app_id=$1 and kind='pull_apple' order by created_at desc limit 1",
      [appId],
    );
    return json({
      snapshot: snapshot?.current_snapshot ?? null,
      previous: snapshot?.previous_snapshot ?? null,
      stale: !!snapshot && snapshot.config_revision !== snapshot.live_revision,
      job: job ?? null,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  let client;
  try {
    await authorize(request);
    const input = z
      .object({
        appId: z.uuid(),
        appInfoId: z.string().trim().max(200).default(""),
      })
      .strict()
      .parse(await request.json());
    client = await pool().connect();
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `pull:${input.appId}`,
    ]);
    const {
      rows: [workspace],
    } = await client.query(
      "select apps from workspaces where id='default' for share",
    );
    if (
      !workspace?.apps.some(
        (a: { id: string; apple: string }) => a.id === input.appId && a.apple,
      )
    )
      throw new HttpError(404, "Apple 应用不存在");
    const {
      rows: [config],
    } = await client.query(
      "select fields,revision from connection_configs where id=$1",
      [`apple:${input.appId}`],
    );
    if (!config || !configFields.apple.parse(config.fields).version)
      throw new HttpError(400, "请先配置 Apple 凭据、平台及明确的目标版本号");
    const pending = await client.query(
      "select id from jobs where app_id=$1 and kind='pull_apple' and status in ('queued','running')",
      [input.appId],
    );
    if (pending.rowCount) throw new HttpError(409, "已有拉取任务，请等待完成");
    const id = crypto.randomUUID();
    await client.query(
      "insert into jobs(id,app_id,platform,kind,input) values($1,$2,'apple','pull_apple',$3)",
      [
        id,
        input.appId,
        { configRevision: config.revision, appInfoId: input.appInfoId },
      ],
    );
    await client.query(
      "select graphile_worker.add_job('pull_apple',$1::json,queue_name := $2,max_attempts := 1)",
      [JSON.stringify({ id }), `${input.appId}:apple`],
    );
    await client.query("commit");
    return json({ id }, 202);
  } catch (e) {
    if (client) await client.query("rollback");
    return failure(e);
  } finally {
    client?.release();
  }
}
