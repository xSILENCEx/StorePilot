import { loadEnvConfig } from "@next/env";
import { getMigrations } from "better-auth/db/migration";
import { sqlite, closeDb } from "../lib/db";
import { auth } from "../lib/auth";
loadEnvConfig(process.cwd());
async function main() {
  sqlite();
  await (await getMigrations(auth().options)).runMigrations();
  console.log("SQLite 数据库和管理员登录表已初始化");
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDb);
