import { randomBytes } from "node:crypto";
import { readFile, appendFile, chmod } from "node:fs/promises";
async function main() {
  const path = ".env.local";
  const contents = await readFile(path, "utf8");
  if (/^\s*STOREPILOT_MASTER_KEY\s*=/m.test(contents)) {
    console.log("主密钥已存在，保留原值。");
    return;
  }
  await appendFile(
    path,
    `\nSTOREPILOT_MASTER_KEY=${randomBytes(32).toString("base64")}\n`,
    { mode: 0o600 },
  );
  await chmod(path, 0o600);
  console.log(
    "已生成凭据加密主密钥，请重启 Web 和 Worker。备份时保留 .env.local；不要替换已有主密钥。",
  );
}
main().catch(() => {
  console.error("无法更新 .env.local，请先运行 setup:local 并检查文件权限");
  process.exitCode = 1;
});
