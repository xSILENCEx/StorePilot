import { loadEnvConfig } from "@next/env";
import { run } from "graphile-worker";
import { pool } from "../lib/db";
import { taskList } from "../lib/tasks";
loadEnvConfig(process.cwd());
run({ pgPool: pool(), concurrency: 2, taskList, pollInterval: 1000 }).catch(
  (e) => {
    console.error(e);
    process.exitCode = 1;
    void pool().end();
  },
);
