import { spawn, execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  writeFile,
  unlink,
  open,
} from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(root);
const statePath = path.join(root, "data/services.json");
const lockPath = path.join(root, "data/service-control.lock");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function startTime(pid) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}
function alive(record) {
  return (
    !!record?.pid &&
    !!record.started &&
    startTime(record.pid) === record.started
  );
}
async function state() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}
async function store(value) {
  await writeFile(statePath, JSON.stringify(value, null, 2), { mode: 0o600 });
}
function portReady(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
async function webReady() {
  try {
    return (
      (
        await fetch("http://127.0.0.1:3000/login", {
          signal: AbortSignal.timeout(2000),
        })
      ).status === 200
    );
  } catch {
    return false;
  }
}
async function waitFor(check, label) {
  for (let i = 0; i < 60; i++) {
    if (await check()) return;
    await pause(300);
  }
  throw new Error(`${label} 未在预期时间内就绪，请查看 data/logs/ 下的日志`);
}
async function launch(name, args, records) {
  if (alive(records[name])) return;
  const log = openSync(path.join(root, `data/logs/${name}.log`), "a", 0o600);
  const child = spawn(process.execPath, args, {
    cwd: root,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, NODE_ENV: "production" },
  });
  closeSync(log);
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  const started = startTime(child.pid);
  if (!started) throw new Error(`${name} 启动失败，请查看对应日志`);
  records[name] = { pid: child.pid, started };
  await store(records);
}
async function lock() {
  try {
    const file = await open(lockPath, "wx", 0o600);
    await file.writeFile(String(process.pid));
    await file.close();
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const pid = Number(await readFile(lockPath, "utf8"));
    let running = true;
    if (pid > 0) {
      try {
        process.kill(pid, 0);
      } catch {
        running = false;
      }
    }
    if (running) throw new Error("另一个服务控制命令正在执行，请稍后重试");
    await unlink(lockPath);
    return lock();
  }
}
async function stopService(name, records) {
  if (!alive(records[name])) {
    delete records[name];
    return;
  }
  process.kill(-records[name].pid, "SIGTERM");
  for (let i = 0; i < 50; i++) {
    if (!alive(records[name])) {
      delete records[name];
      await store(records);
      return;
    }
    await pause(200);
  }
  throw new Error(
    `${name} 仍在退出中，未强制结束，请稍后运行 services:status 检查`,
  );
}
async function main() {
  const action = process.argv[2];
  if (!["start", "stop", "status"].includes(action))
    throw new Error(
      "用法：npm run services:start / services:stop / services:status",
    );
  await mkdir("data/logs", { recursive: true, mode: 0o700 });
  if (action !== "status") await lock();
  try {
    const records = await state();
    if (action === "status") {
      for (const name of ["web", "worker"])
        console.log(
          `${name}: ${alive(records[name]) ? "运行中（PID " + records[name].pid + "）" : "未由本脚本运行"}`,
        );
      console.log(
        `网页：${(await webReady()) ? "正常 http://127.0.0.1:3000" : "未响应"}`,
      );
      return;
    }
    if (action === "stop") {
      for (const name of ["web", "worker"]) await stopService(name, records);
      await store(records);
      console.log("已停止本脚本管理的服务，数据库和素材保留。");
      return;
    }
    await access(".next/BUILD_ID").catch(() => {
      throw new Error("缺少生产构建，请先运行 npm run build");
    });
    if (!alive(records.web) && (await portReady("127.0.0.1", 3000)))
      throw new Error(
        "3000 端口被非本脚本管理的进程占用，请先停止对应 Web 服务，避免重复启动",
      );
    await launch(
      "web",
      [
        path.join(root, "node_modules/next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
      ],
      records,
    );
    await waitFor(webReady, "Web");
    await launch(
      "worker",
      ["--import", "tsx", path.join(root, "scripts/worker.ts")],
      records,
    );
    await pause(500);
    if (!alive(records.worker))
      throw new Error("Worker 启动失败，请检查 data/logs/worker.log");
    console.log("StorePilot 已启动：http://127.0.0.1:3000");
    console.log("服务独立于当前终端运行；日志：data/logs/{web,worker}.log");
  } finally {
    if (action !== "status") await unlink(lockPath).catch(() => {});
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
