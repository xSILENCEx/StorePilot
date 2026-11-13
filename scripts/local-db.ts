import { loadEnvConfig } from "@next/env";
import EmbeddedPostgres from "embedded-postgres";
import { access, chmod } from "node:fs/promises";
loadEnvConfig(process.cwd());
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("先运行 npm run setup:local");
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== "127.0.0.1")
    throw new Error("db:local 仅管理本机 127.0.0.1 数据库");
  const postgres = new EmbeddedPostgres({
    databaseDir: "./data/postgres",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    port: Number(url.port),
    persistent: true,
    authMethod: "scram-sha-256",
    postgresFlags: ["-h", "127.0.0.1", "-k", "/tmp"],
    onLog: (message) => {
      if (/ready to accept connections/.test(message))
        console.log("PostgreSQL 已就绪");
    },
    onError: (message) => console.error(message),
  });
  try {
    await access("data/postgres/PG_VERSION");
  } catch {
    await postgres.initialise();
    await chmod("data/postgres", 0o700);
  }
  await postgres.start();
  const client = postgres.getPgClient();
  await client.connect();
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error("不支持的数据库名称");
  const found = await client.query(
    "select 1 from pg_database where datname=$1",
    [name],
  );
  if (!found.rowCount) await client.query(`create database "${name}"`);
  await client.end();
  console.log(
    `本机数据库运行于 127.0.0.1:${url.port}；按 Ctrl+C 停止，数据保留。`,
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await postgres.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
