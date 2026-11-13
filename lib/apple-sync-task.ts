import type { Task } from "graphile-worker";
import { pool } from "./db";
import { workerConfig } from "./config-store";
import { AppleReadError, readAppleSnapshot } from "./apple-sync";
export const pullAppleTask: Task = async (payload) => {
  const { id } = payload as { id: string };
  const client = await pool().connect();
  try {
    const {
      rows: [job],
    } = await client.query(
      "select * from jobs where id=$1 and kind='pull_apple'",
      [id],
    );
    if (!job || job.status === "succeeded") return;
    await client.query(
      "update jobs set status='running',updated_at=now() where id=$1",
      [id],
    );
    await client.query(
      "insert into job_logs(job_id,step,message) values($1,'read','读取 Apple 应用级与指定版本文案，不修改商店或草稿')",
      [id],
    );
    const config = await workerConfig("apple", job.app_id);
    if (config.revision !== job.input.configRevision)
      throw new AppleReadError("配置已变更，请重新拉取。");
    const snapshot = await readAppleSnapshot(config, job.input.appInfoId);
    await client.query("begin");
    const {
      rows: [current],
    } = await client.query(
      "select revision from connection_configs where id=$1 for share",
      [`apple:${job.app_id}`],
    );
    if (current?.revision !== config.revision)
      throw new AppleReadError("拉取期间配置已变更，未更新快照。");
    const {
      rows: [workspace],
    } = await client.query(
      "select apps from workspaces where id='default' for share",
    );
    if (
      !workspace?.apps.some(
        (a: { id: string; apple: string }) => a.id === job.app_id && a.apple,
      )
    )
      throw new AppleReadError("应用或 Apple 平台已移除，未更新快照。");
    await client.query(
      `insert into store_snapshots(app_id,config_revision,current_snapshot) values($1,$2,$3)
      on conflict(app_id) do update set previous_snapshot=case when store_snapshots.current_snapshot->'target'=excluded.current_snapshot->'target' then store_snapshots.current_snapshot else null end,current_snapshot=excluded.current_snapshot,config_revision=excluded.config_revision,updated_at=now()`,
      [job.app_id, config.revision, snapshot],
    );
    await client.query(
      "update jobs set status='succeeded',result=$2,updated_at=now() where id=$1",
      [
        id,
        {
          message: `已读取 ${Object.keys(snapshot.locales).length} 种语言，草稿未改变`,
          target: snapshot.target,
        },
      ],
    );
    await client.query(
      "insert into job_logs(job_id,step,message) values($1,'complete','远端快照已保存；请在工作台检查差异或导入缺少的语言')",
      [id],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    const message =
      error instanceof AppleReadError
        ? error.message
        : "Apple 拉取失败，请检查配置、数据库或响应格式。原快照和草稿均保留。";
    await client.query(
      "update jobs set status='failed',result=$2,updated_at=now() where id=$1",
      [id, { error: message }],
    );
    await client.query(
      "insert into job_logs(job_id,step,message) values($1,'failed',$2)",
      [id, message],
    );
  } finally {
    client.release();
  }
};
