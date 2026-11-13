import type { Task } from "graphile-worker";
import { pool } from "./db";
import { configId, workerConfig } from "./config-store";
import { checkConnection, type CheckResult } from "./connection-check";
import { configScope } from "./config-model";
export const verifyConnectionTask: Task = async (payload) => {
  const { id } = payload as { id: string };
  const {
    rows: [job],
  } = await pool().query(
    "select * from jobs where id=$1 and kind='verify_connection'",
    [id],
  );
  if (!job || job.status === "succeeded") return;
  const scope = configScope.parse(job.input.scope);
  const { appId, revision, verifyApplication } = job.input;
  const target = configId(scope, appId);
  await pool().query(
    "update jobs set status='running',updated_at=now() where id=$1",
    [id],
  );
  await pool().query(
    "update connection_configs set verification=verification || $3::jsonb where id=$1 and revision=$2 and verification->>'jobId'=$4",
    [
      target,
      revision,
      { status: "running", message: "本机 Worker 正在验证连接" },
      id,
    ],
  );
  let result: CheckResult;
  try {
    const config = await workerConfig(scope, appId);
    if (config.revision !== revision) throw new Error("stale");
    result = await checkConnection(
      scope,
      config,
      { verifyApplication },
      fetch,
      async (step, message) => {
        await pool().query(
          "insert into job_logs(job_id,step,message) values($1,$2,$3)",
          [id, step, message],
        );
      },
    );
  } catch {
    result = {
      status: "failed",
      message: "配置已变更、被清除或无法解密，请重新载入配置后验证。",
      checkedAt: new Date().toISOString(),
      steps: [],
    };
  }
  const client = await pool().connect();
  try {
    await client.query("begin");
    await client.query(
      "update connection_configs set verification=$3 where id=$1 and revision=$2 and verification->>'jobId'=$4",
      [target, revision, { ...result, revision, jobId: id }, id],
    );
    await client.query(
      "update jobs set status=$2,result=$3,updated_at=now() where id=$1",
      [id, result.status === "failed" ? "failed" : "succeeded", result],
    );
    await client.query(
      "insert into job_logs(job_id,step,message) values($1,$2,$3)",
      [id, "complete", result.message],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
};
