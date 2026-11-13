import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { pool } from "../lib/db";
import { encryptSecret } from "../lib/secrets";
import { verifyConnectionTask } from "../lib/connection-task";
import { readConfig } from "../lib/config-store";
loadEnvConfig(process.cwd());
async function main() {
  const appId = crypto.randomUUID();
  const configId = `apple:${appId}`;
  const ids: string[] = [];
  const originalFetch = globalThis.fetch;
  try {
    const secret = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    const fields = {
      issuerId: "57246542-96fe-1a63-e053-0824d011072a",
      keyId: "2X9R4HXF34",
      appId: "123456789",
      bundleId: "com.test.connection",
      appPlatform: "IOS",
      version: "",
    };
    await pool().query(
      "insert into connection_configs(id,scope,app_id,fields,secret,revision) values($1,'apple',$2,$3,$4,1)",
      [configId, appId, fields, encryptSecret(secret, configId)],
    );
    globalThis.fetch = async () =>
      Response.json({
        data: { id: "123456789", attributes: { bundleId: fields.bundleId } },
      });
    async function createJob(revision: number) {
      const id = crypto.randomUUID();
      ids.push(id);
      await pool().query(
        "insert into jobs(id,app_id,platform,kind,input) values($1,$2,'apple','verify_connection',$3)",
        [id, appId, { scope: "apple", appId, revision }],
      );
      await pool().query(
        "update connection_configs set verification=$2 where id=$1",
        [configId, { status: "queued", revision, jobId: id }],
      );
      return id;
    }
    const id = await createJob(1);
    await verifyConnectionTask(
      { id },
      {} as Parameters<typeof verifyConnectionTask>[1],
    );
    const state = await readConfig("apple", appId);
    assert.equal(state.verified, true);
    assert.equal(state.verification.status, "passed");
    assert.equal("secret" in state, false);
    const { rows: logs } = await pool().query(
      "select message from job_logs where job_id=$1",
      [id],
    );
    assert.ok(logs.length >= 2);
    assert.ok(!JSON.stringify(logs).includes(secret));
    const stale = await createJob(1);
    await pool().query(
      "update connection_configs set revision=2,verification=null where id=$1",
      [configId],
    );
    await verifyConnectionTask(
      { id: stale },
      {} as Parameters<typeof verifyConnectionTask>[1],
    );
    const changed = await readConfig("apple", appId);
    assert.equal(changed.verified, false);
    assert.equal(changed.verification, null);
    const {
      rows: [job],
    } = await pool().query("select status from jobs where id=$1", [stale]);
    assert.equal(job.status, "failed");
    console.log(
      "通过：Worker 验证结果持久化、步骤日志、不回显密钥、配置修改后旧任务不回写。使用模拟外部响应，未读取或修改用户配置。",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await pool().query("delete from job_logs where job_id=any($1)", [ids]);
    await pool().query("delete from jobs where id=any($1)", [ids]);
    await pool().query("delete from connection_configs where id=$1", [
      configId,
    ]);
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
