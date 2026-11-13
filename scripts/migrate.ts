import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import { pool } from "../lib/db";
import { auth } from "../lib/auth";
import { getMigrations } from "better-auth/db/migration";
import { makeWorkerUtils } from "graphile-worker";
loadEnvConfig(process.cwd());
async function main() {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(73501901)");
    await client.query(
      "create table if not exists storepilot_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    for (const name of [
      "001_foundation",
      "002_configs",
      "003_verification",
      "004_screenshots",
      "005_screenshot_history",
      "006_store_snapshots",
    ]) {
      const applied = await client.query(
        "select name from storepilot_migrations where name=$1",
        [name],
      );
      if (!applied.rowCount) {
        await client.query(await readFile(`db/${name}.sql`, "utf8"));
        await client.query(
          "insert into storepilot_migrations(name) values($1)",
          [name],
        );
      }
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  const migrations = await getMigrations(auth().options);
  await migrations.runMigrations();
  const worker = await makeWorkerUtils({ pgPool: pool() });
  await worker.migrate();
  await worker.release();
  console.log("数据库、Better Auth 与 Graphile Worker 迁移完成");
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
