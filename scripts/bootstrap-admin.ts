import { loadEnvConfig } from "@next/env";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { auth } from "../lib/auth";
import { sqlite, closeDb } from "../lib/db";
loadEnvConfig(process.cwd());
async function main() {
  const rows = sqlite().prepare('select id from "user" limit 1').all();
  if (rows.length) throw new Error("已存在管理员；不会生成或覆盖登录信息");
  const email = "admin@storepilot.local";
  const password = randomBytes(24).toString("base64url");
  await auth(true).api.signUpEmail({
    body: { name: "管理员", email, password },
  });
  await mkdir("data", { recursive: true, mode: 0o700 });
  await writeFile(
    "data/admin-login.json",
    JSON.stringify({ email, password }, null, 2),
    { mode: 0o600 },
  );
  console.log(
    "已创建本机管理员，登录信息保存至 data/admin-login.json（仅当前用户可读）。",
  );
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "初始化失败");
    process.exitCode = 1;
  })
  .finally(closeDb);
