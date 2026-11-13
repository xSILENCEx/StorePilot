import { z } from "zod";
import { configTarget as target } from "../../../../../lib/config-target";
import { failure, HttpError, json } from "../../../../../lib/http";
import { configId } from "../../../../../lib/config-store";
import { pool } from "../../../../../lib/db";
export async function POST(
  request: Request,
  context: { params: Promise<{ scope: string }> },
) {
  let client;
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
    client = await pool().connect();
    await client.query("begin");
    const targetId = configId(scope, appId);
    const {
      rows: [config],
    } = await client.query(
      "select revision,secret,verification from connection_configs where id=$1 for update",
      [targetId],
    );
    if (!config?.secret) throw new HttpError(400, "请先保存连接配置");
    if (config.revision !== input.revision)
      throw new HttpError(409, "配置已变更，请重新载入后验证");
    if (["queued", "running"].includes(config.verification?.status)) {
      const {
        rows: [existing],
      } = await client.query("select status from jobs where id=$1", [
        config.verification.jobId,
      ]);
      if (existing && ["queued", "running"].includes(existing.status)) {
        await client.query("commit");
        return json({ id: config.verification.jobId }, 202);
      }
    }
    const id = crypto.randomUUID();
    await client.query(
      "insert into jobs(id,app_id,platform,kind,input) values($1,$2,$3,'verify_connection',$4)",
      [
        id,
        appId ?? "workspace",
        scope,
        {
          scope,
          appId,
          revision: input.revision,
          verifyApplication: input.verifyApplication ?? false,
        },
      ],
    );
    await client.query(
      "update connection_configs set verification=$2 where id=$1",
      [
        targetId,
        {
          status: "queued",
          revision: input.revision,
          jobId: id,
          message: "验证任务已入队，等待本机 Worker",
        },
      ],
    );
    await client.query(
      "select graphile_worker.add_job('verify_connection',$1::json,queue_name := $2,max_attempts := 1)",
      [JSON.stringify({ id }), `${appId ?? "workspace"}:${scope}`],
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
