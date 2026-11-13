import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { pool } from "../lib/db";
loadEnvConfig(process.cwd());
async function main() {
  if (process.argv[2] === "prepare") {
    const id = crypto.randomUUID();
    const appId = crypto.randomUUID();
    const sentinel = {
      id: appId,
      name: "重启恢复验证",
      apple: "com.test",
      google: "",
      drafts: {
        "apple:en-US": {
          title: "重启前保存的草稿",
          subtitle: "",
          description: "验证持久化数据",
          keywords: "",
          images: [],
        },
      },
    };
    const client = await pool().connect();
    try {
      await client.query("begin");
      await client.query(
        "update workspaces set apps=apps || $1::jsonb, revision=revision+1 where id='default'",
        [JSON.stringify([sentinel])],
      );
      await client.query(
        "insert into jobs(id,app_id,platform,kind,input) values($1,$2,'apple','validate_draft',$3)",
        [id, appId, sentinel],
      );
      await client.query(
        "select graphile_worker.add_job('validate_draft',$1::json,queue_name := $2)",
        [JSON.stringify({ id }), appId + ":apple"],
      );
      await client.query("commit");
    } finally {
      client.release();
    }
    const {
      rows: [workspace],
    } = await pool().query(
      "select revision,apps from workspaces where id='default'",
    );
    await writeFile(
      "data/restart-probe.json",
      JSON.stringify({ id, appId, workspace }),
      { mode: 0o600 },
    );
    console.log("Worker 停止时已入队任务；数据库草稿快照已记录。");
  } else {
    const probe = JSON.parse(await readFile("data/restart-probe.json", "utf8"));
    const {
      rows: [workspace],
    } = await pool().query(
      "select revision,apps from workspaces where id='default'",
    );
    assert.deepEqual(workspace, probe.workspace);
    let done = false;
    for (let i = 0; i < 30; i++) {
      const {
        rows: [job],
      } = await pool().query("select status from jobs where id=$1", [probe.id]);
      if (job?.status === "succeeded") {
        done = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(done, "重启后应恢复执行队列任务");
    await pool().query(
      "update workspaces set apps=(select coalesce(jsonb_agg(item), '[]'::jsonb) from jsonb_array_elements(apps) item where item->>'id' <> $1), revision=revision+1 where id='default'",
      [probe.appId],
    );
    await unlink("data/restart-probe.json");
    console.log(
      "通过：PostgreSQL 重启后草稿保留，Worker 重启后执行此前入队任务。",
    );
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
