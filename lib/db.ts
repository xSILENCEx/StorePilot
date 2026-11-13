import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
const globalDb = globalThis as unknown as { storepilotPool?: Pool };
export function pool() {
  if (!process.env.DATABASE_URL)
    throw new Error("请先配置 DATABASE_URL 并运行 npm run db:migrate");
  if (!globalDb.storepilotPool) {
    globalDb.storepilotPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
    globalDb.storepilotPool.on("connect", (client) => {
      client.on("error", () => console.error("PostgreSQL 客户端连接断开。"));
    });
    globalDb.storepilotPool.on("error", () =>
      console.error("PostgreSQL 连接异常，请检查本机数据库进程。"),
    );
  }
  return globalDb.storepilotPool;
}
export function db() {
  return drizzle(pool());
}
