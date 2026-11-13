import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
async function main() {
  const password = randomBytes(24).toString("hex");
  await writeFile(
    ".env.local",
    `DATABASE_URL=postgresql://storepilot:${password}@127.0.0.1:55432/storepilot\nBETTER_AUTH_URL=http://127.0.0.1:3000\nBETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}\nSTOREPILOT_MASTER_KEY=${randomBytes(32).toString("base64")}\nSTORAGE_PATH=./data/assets\n`,
    { flag: "wx", mode: 0o600 },
  );
  await mkdir("data", { recursive: true, mode: 0o700 });
  console.log(
    "已生成 .env.local；下一步运行 npm run db:local，另开终端运行 npm run db:migrate。",
  );
}
main().catch((e) => {
  console.error(e.code === "EEXIST" ? ".env.local 已存在，保留原配置。" : e);
  process.exitCode = 1;
});
