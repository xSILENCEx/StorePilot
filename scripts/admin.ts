import { loadEnvConfig } from "@next/env";
import { auth } from "../lib/auth";
import { pool } from "../lib/db";
loadEnvConfig(process.cwd());
async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error(
      "通过环境变量设置 ADMIN_EMAIL 和至少 12 字符的 ADMIN_PASSWORD",
    );
  const result = await auth(true).api.signUpEmail({
    body: { email, password, name: "管理员" },
  });
  console.log(`已创建管理员：${result.user.email}`);
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "创建失败");
    process.exitCode = 1;
  })
  .finally(() => pool().end());
