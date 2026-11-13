import { loadEnvConfig } from "@next/env";
import { runWorker } from "../lib/worker";
import { executeJob } from "../lib/tasks";
import { closeDb } from "../lib/db";
loadEnvConfig(process.cwd());
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
runWorker(executeJob, controller.signal)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDb);
