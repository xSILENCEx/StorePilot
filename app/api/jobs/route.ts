import { z } from "zod";
import { pool } from "../../../lib/db";
import { authorize, failure, HttpError, json } from "../../../lib/http";
export async function GET(request: Request) {
  try {
    await authorize(request);
    const { rows } = await pool().query(
      "select id,app_id,platform,kind,status,result,created_at,updated_at from jobs order by created_at desc limit 30",
    );
    const logs = await pool().query(
      "select job_id,step,message,created_at from job_logs where job_id = any($1) order by id",
      [rows.map((j) => j.id)],
    );
    return json({
      jobs: rows.map((j) => ({
        ...j,
        logs: logs.rows.filter((l) => l.job_id === j.id),
      })),
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
      .union([
        z.object({ appId: z.uuid(), platform: z.enum(["apple", "google"]) }),
        z.object({ retryId: z.uuid() }),
      ])
      .parse(await request.json());
    client = await pool().connect();
    await client.query("begin");
    let app;
    let platform;
    if ("retryId" in input) {
      const {
        rows: [previous],
      } = await client.query(
        "select * from jobs where id=$1 and status='failed' and kind='validate_draft'",
        [input.retryId],
      );
      if (!previous) throw new HttpError(409, "仅可重试已结束的失败任务");
      app = previous.input;
      platform = previous.platform;
    } else {
      const {
        rows: [workspace],
      } = await client.query(
        "select apps from workspaces where id='default' for share",
      );
      app = workspace?.apps.find((a: { id: string }) => a.id === input.appId);
      if (!app || !app[input.platform])
        throw new HttpError(404, "应用或平台不存在");
      platform = input.platform;
    }
    const id = crypto.randomUUID();
    await client.query(
      "insert into jobs(id,app_id,platform,kind,input) values($1,$2,$3,'validate_draft',$4)",
      [id, app.id, platform, app],
    );
    await client.query(
      "select graphile_worker.add_job('validate_draft', $1::json, queue_name := $2, max_attempts := 3)",
      [JSON.stringify({ id }), `${app.id}:${platform}`],
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
