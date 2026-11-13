import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { makeWorkerUtils, runOnce } from "graphile-worker";
import { getMigrations } from "better-auth/db/migration";
import { pool } from "../lib/db";
import { auth } from "../lib/auth";
import { saveConfig } from "../lib/config-store";
import { pullAppleTask } from "../lib/apple-sync-task";
import { GET, POST } from "../app/api/apple-sync/route";
import { config, mockApple } from "../tests/apple-sync-fixtures";
loadEnvConfig(process.cwd());
async function main() {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const name = `storepilot_apple_test_${randomBytes(6).toString("hex")}`;
  const originalFetch = globalThis.fetch;
  let created = false;
  try {
    await admin.query(`create database "${name}"`);
    created = true;
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = "/" + name;
    process.env.DATABASE_URL = url.href;
    process.env.STOREPILOT_MASTER_KEY = randomBytes(32).toString("base64");
    process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
    const origin = (process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000");
    for (const migration of [
      "001_foundation",
      "002_configs",
      "003_verification",
      "004_screenshots",
      "005_screenshot_history",
      "006_store_snapshots",
    ])
      await pool().query(await readFile(`db/${migration}.sql`, "utf8"));
    await (await getMigrations(auth().options)).runMigrations();
    const utils = await makeWorkerUtils({ pgPool: pool() });
    await utils.migrate();
    await utils.release();
    const credentials = {
      email: "apple-test@example.test",
      password: randomBytes(24).toString("hex"),
    };
    await auth(true).api.signUpEmail({
      body: { ...credentials, name: "Apple test" },
    });
    const login = await auth().handler(
      new Request(origin + "/api/auth/sign-in/email", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      }),
    );
    assert.equal(login.status, 200);
    const cookie = login.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    const appId = randomUUID();
    const apps = [
      {
        id: appId,
        name: "Test",
        apple: "test.app",
        google: "",
        drafts: {
          "apple:en-US": {
            title: "Local unsynced",
            subtitle: "",
            description: "",
            keywords: "",
            images: [],
          },
        },
      },
    ];
    await pool().query(
      "insert into workspaces(id,apps) values('default',$1) on conflict(id) do update set apps=excluded.apps",
      [JSON.stringify(apps)],
    );
    await saveConfig("apple", appId, 0, config.fields, config.secret);
    const request = (body?: object, originHeader = origin) =>
      new Request(`${origin}/api/apple-sync?appId=${appId}`, {
        method: body ? "POST" : "GET",
        headers: {
          Cookie: cookie,
          Origin: originHeader,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    assert.equal(
      (await GET(new Request(`${origin}/api/apple-sync?appId=${appId}`)))
        .status,
      401,
    );
    assert.equal(
      (await POST(request({ appId }, "https://evil.invalid"))).status,
      403,
    );
    globalThis.fetch = mockApple();
    async function enqueueAndRun() {
      const response = await POST(request({ appId }));
      assert.equal(
        response.status,
        202,
        JSON.stringify(await response.clone().json()),
      );
      const { id } = await response.json();
      assert.equal((await POST(request({ appId }))).status, 409);
      await runOnce({
        pgPool: pool(),
        taskList: { pull_apple: pullAppleTask },
        concurrency: 1,
      });
      return id;
    }
    await enqueueAndRun();
    let state = await (await GET(request())).json();
    assert.equal(state.job.status, "succeeded");
    assert.equal(state.snapshot.locales["en-US"].draft.title, "Remote");
    assert.equal(state.previous, null);
    globalThis.fetch = mockApple({ title: "Remote changed" });
    await enqueueAndRun();
    state = await (await GET(request())).json();
    assert.equal(state.snapshot.locales["en-US"].draft.title, "Remote changed");
    assert.equal(state.previous.locales["en-US"].draft.title, "Remote");
    globalThis.fetch = mockApple({ fail: true });
    await enqueueAndRun();
    state = await (await GET(request())).json();
    assert.equal(state.job.status, "failed");
    assert.equal(state.snapshot.locales["en-US"].draft.title, "Remote changed");
    const {
      rows: [workspace],
    } = await pool().query(
      "select apps,revision from workspaces where id='default'",
    );
    assert.deepEqual(workspace.apps, apps);
    assert.equal(workspace.revision, 0);
    // Change credentials while a network request is in flight: old result must not replace snapshot.
    const fixtureFetch = mockApple({ title: "Must not persist" });
    let changed = false;
    globalThis.fetch = async (...args) => {
      if (!changed) {
        changed = true;
        await saveConfig("apple", appId, 1, config.fields, config.secret);
      }
      return fixtureFetch(...args);
    };
    await enqueueAndRun();
    state = await (await GET(request())).json();
    assert.equal(state.job.status, "failed");
    assert.equal(state.stale, true);
    assert.equal(state.snapshot.locales["en-US"].draft.title, "Remote changed");
    console.log(
      "Apple sync verified: authentication, origin, queue deduplication, real Worker, snapshots, failure preservation, untouched drafts and configuration race.",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (created) {
      await pool().end();
      await admin.query(`drop database "${name}" with (force)`);
    }
    await admin.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
