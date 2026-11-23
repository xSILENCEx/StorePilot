import { GET as listJobs } from "../app/api/jobs/route";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../lib/db";
import { auth } from "../lib/auth";
import { jobs, workspaces, connectionConfigs } from "../lib/schema";
import { saveConfig, readConfig } from "../lib/config-store";
import {
  acquireWorker,
  claimJob,
  recoverJobs,
  releaseWorker,
} from "../lib/worker";
import { enqueue, finishJob } from "../lib/job-store";
import { workerContext } from "../lib/worker-context";
import { executeJob } from "../lib/tasks";
import { GET as getApps, PUT as saveApps } from "../app/api/apps/route";
import { POST as uploadAsset } from "../app/api/assets/route";
import { POST as verify } from "../app/api/settings/[scope]/verify/route";

import { workflowFixture } from "./workflow-fixture";
test("工作区、凭据与 Worker", async (t) => {
  const { origin, cookie, appId, app, draft, request, configureImages } =
    await workflowFixture(t);
  await t.test("上传和已有素材转为商店图片时按目标校验，拒绝放大", async () => {
    const png = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: "blue",
      },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(png)], "icon.png", { type: "image/png" }),
    );
    const send = (body: FormData) =>
      uploadAsset(
        new Request(origin + "/api/assets", {
          method: "POST",
          headers: { cookie, Origin: origin },
          body,
        }),
      );
    form.set(
      "target",
      JSON.stringify({ kind: "graphic", platform: "google", type: "icon" }),
    );
    const response = await send(form);
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.deepEqual([result.width, result.height], [512, 512]);
    form.delete("file");
    form.set("asset", result.url);
    assert.equal((await (await send(form)).json()).url, result.url);
    form.set(
      "target",
      JSON.stringify({
        kind: "graphic",
        platform: "google",
        type: "featureGraphic",
      }),
    );
    assert.equal((await send(form)).status, 400);
  });
  await t.test("鉴权、关闭注册、修订冲突与来源限制", async () => {
    assert.equal(
      (await getApps(new Request(origin + "/api/apps"))).status,
      401,
    );
    const registration = await auth().api.signUpEmail({
      body: {
        email: "denied@test.local",
        password: "fixture-password-123",
        name: "Denied",
      },
      asResponse: true,
    });
    assert.ok(registration.status >= 400);
    assert.equal(
      (
        await saveApps(
          request("/api/apps", "PUT", { apps: [app], revision: 0 }),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await saveApps(
          request("/api/apps", "PUT", { apps: [app], revision: 0 }),
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await saveApps(
          request(
            "/api/apps",
            "PUT",
            { apps: [app], revision: 1 },
            { Origin: "https://wrong.invalid" },
          ),
        )
      ).status,
      403,
    );
    closeDb();
    assert.equal(db().select().from(workspaces).get()?.apps[0].id, appId);
  });
  await configureImages();
  await t.test("凭据加密、修订冲突与连接验证", async () => {
    const stored = db()
      .select()
      .from(connectionConfigs)
      .where(eq(connectionConfigs.id, "image:global"))
      .get()!;
    assert.ok(!stored.secret.includes("fixture-key"));
    assert.ok(
      !JSON.stringify(await readConfig("image")).includes(stored.secret),
    );
    await assert.rejects(
      saveConfig("image", undefined, 0, stored.fields),
      /其他窗口/,
    );
    globalThis.fetch = async (input) => {
      assert.equal(String(input), "https://images.example/v1/models");
      return Response.json({ data: [{ id: "fixture-model" }] });
    };
    const response = await verify(
      request("/api/settings/image/verify", "POST", { revision: 1 }),
      { params: Promise.resolve({ scope: "image" }) },
    );
    assert.equal(response.status, 202);
    const owner = randomUUID();
    assert.ok(acquireWorker(owner));
    const job = claimJob(owner)!;
    await executeJob(job);
    releaseWorker(owner);
    assert.equal((await readConfig("image")).verified, true);
  });
  await t.test(
    "租约过期禁止旧 Worker 写入；中断的 Google 验证停止轮询",
    async () => {
      const id = enqueue({
        app_id: appId,
        platform: "google",
        kind: "verify_connection",
        input: {
          scope: "google",
          appId,
          revision: 1,
          verifyApplication: true,
        },
      });
      db().update(jobs).set({ status: "running" }).where(eq(jobs.id, id)).run();
      db()
        .insert(connectionConfigs)
        .values({
          id: `google:${appId}`,
          scope: "google",
          app_id: appId,
          fields: {},
          secret: "unused-fixture",
          verification: {
            status: "queued",
            revision: 1,
            jobId: id,
            message: "queued",
          },
        })
        .run();
      const owner = randomUUID();
      assert.ok(acquireWorker(owner, Date.now() - 40000));
      assert.throws(
        () => workerContext.run(owner, () => finishJob(id, "succeeded", {})),
        /lease expired/,
      );
      releaseWorker(owner);
      await recoverJobs();
      assert.equal(
        db().select().from(jobs).where(eq(jobs.id, id)).get()?.status,
        "uncertain",
      );
      assert.equal(
        (await readConfig("google", appId)).verification?.status,
        "uncertain",
      );
    },
  );
  await t.test("独立 Worker 进程读取 SQLite 队列并执行", async () => {
    const id = enqueue({
      app_id: appId,
      platform: "apple",
      kind: "validate_draft",
      input: app,
    });
    closeDb();
    const script = `const { runWorker } = require('./lib/worker.ts'); const { executeJob } = require('./lib/tasks.ts'); const { closeDb } = require('./lib/db.ts'); (async () => { const controller = new AbortController(); await runWorker(async job => { await executeJob(job); controller.abort(); }, controller.signal); closeDb(); })().catch(error => { console.error(error); process.exitCode = 1; });`;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "-e", script],
      { encoding: "utf8", env: process.env, timeout: 20000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      db().select().from(jobs).where(eq(jobs.id, id)).get()?.status,
      "succeeded",
    );
    assert.throws(() => claimJob("missing-lease"), /lease/);
  });

  await t.test("当前应用的任务在全局最近 30 条以外仍然可见", async () => {
    const other = randomUUID();
    db().update(jobs).set({ created_at: "2000-01-01T00:00:00.000Z" }).run();
    for (let i = 0; i < 31; i++)
      enqueue({
        app_id: other,
        kind: "validate_draft",
        platform: "apple",
        input: {},
      });
    const response = await listJobs(request("/api/jobs?appId=" + appId));
    const { jobs: rows } = await response.json();
    assert.ok(rows.length);
    assert.ok(rows.every((row: { app_id: string }) => row.app_id === appId));
    const global = await (await listJobs(request("/api/jobs"))).json();
    assert.equal(global.jobs.length, 30);
    assert.ok(
      global.jobs.every((row: { app_id: string }) => row.app_id === other),
    );
  });
});
