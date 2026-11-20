import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { getMigrations } from "better-auth/db/migration";
import { db, sqlite, closeDb } from "../lib/db";
import { auth } from "../lib/auth";
import {
  jobs,
  workspaces,
  connectionConfigs,
  storeSnapshots,
} from "../lib/schema";
import { saveConfig, readConfig } from "../lib/config-store";
import { storeAsset } from "../lib/storage";
import {
  acquireWorker,
  claimJob,
  recoverJobs,
  releaseWorker,
} from "../lib/worker";
import { enqueue, finishJob } from "../lib/job-store";
import { workerContext } from "../lib/worker-context";
import {
  POST as queueGoogle,
  GET as googleState,
} from "../app/api/google-sync/route";
import { pullGoogleTask } from "../lib/google-sync-task";
import { pullAppleTask } from "../lib/apple-sync-task";
import { executeJob } from "../lib/tasks";
import { checkpointReply } from "../lib/image-provider";
import { GET as getApps, PUT as saveApps } from "../app/api/apps/route";
import { GET as getImages, POST as generate } from "../app/api/images/route";
import { DELETE as removeImage } from "../app/api/images/[id]/route";
import { GET as getAsset } from "../app/api/assets/[id]/route";
import { POST as verify } from "../app/api/settings/[scope]/verify/route";
import { POST as pullApple } from "../app/api/apple-sync/route";
import { config as appleConfig, mockApple } from "./apple-sync-fixtures";

test("SQLite 工作流：登录、草稿、直调图像 API、去重、重启恢复及 Apple 拉取", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "storepilot-test-"));
  const originalFetch = globalThis.fetch;
  process.env.DATABASE_PATH = path.join(directory, "storepilot.sqlite");
  process.env.STORAGE_PATH = path.join(directory, "assets");
  process.env.STOREPILOT_MASTER_KEY = randomBytes(32).toString("base64");
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
  const origin = (process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000");
  try {
    await (await getMigrations(auth().options)).runMigrations();
    await auth(true).api.signUpEmail({
      body: {
        email: "test@storepilot.local",
        password: "fixture-password-123",
        name: "Test",
      },
    });
    const login = await auth().api.signInEmail({
      body: {
        email: "test@storepilot.local",
        password: "fixture-password-123",
      },
      asResponse: true,
    });
    assert.equal(login.status, 200);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.ok(cookie);
    function request(
      url: string,
      method = "GET",
      body?: unknown,
      headers = {},
    ) {
      return new Request(origin + url, {
        method,
        headers: {
          cookie,
          Origin: origin,
          "Content-Type": "application/json",
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    const appId = randomUUID();
    const draft = {
      title: "Test",
      subtitle: "",
      description: "",
      keywords: "",
      images: [] as string[],
    };
    const app = {
      id: appId,
      name: "Fixture",
      apple: "test.app",
      google: "test.app",
      drafts: { "apple:en-US": draft, "google:en-US": draft },
    };
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
    await saveConfig(
      "image",
      undefined,
      0,
      {
        baseUrl: "https://images.example/v1",
        model: "fixture-model",
        timeoutSeconds: 30,
      },
      "fixture-key",
    );
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
    const bytes = await sharp({
      create: { width: 80, height: 120, channels: 3, background: "#168766" },
    })
      .png()
      .toBuffer();
    const reference = await storeAsset(bytes);
    assert.equal((await storeAsset(bytes)).id, reference.id);
    assert.equal(
      (
        await getAsset(new Request(origin + reference.url), {
          params: Promise.resolve({ id: reference.id }),
        })
      ).status,
      401,
    );
    const downloaded = await getAsset(request(reference.url), {
      params: Promise.resolve({ id: reference.id }),
    });
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get("cache-control")!, /no-store/);
    let modelCalls = 0;
    const target = { appId, platform: "apple", locale: "en-US" };
    const modelFetch: typeof fetch = async (input, init) => {
      modelCalls++;
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer fixture-key",
      );
      if (String(input).endsWith("edits")) {
        assert.ok(init?.body instanceof FormData);
        assert.ok(init.body.get("image") instanceof Blob);
        assert.equal(init.body.get("prompt"), "exact user prompt");
      } else {
        assert.equal(
          String(input),
          "https://images.example/v1/images/generations",
        );
        const body = JSON.parse(init!.body as string);
        assert.equal(body.prompt, "exact user prompt");
        assert.equal(body.model, "fixture-model");
        assert.equal(body.n, 1);
      }
      return Response.json({ data: [{ b64_json: bytes.toString("base64") }] });
    };
    async function submit(references: string[] = []) {
      const input = {
        ...target,
        requestId: randomUUID(),
        settings: { prompt: "exact user prompt", references },
      };
      const response = await generate(request("/api/images", "POST", input));
      assert.equal(response.status, 202, await response.clone().text());
      return { input, id: (await response.json()).id as string };
    }
    let generatedId = "";
    await t.test(
      "提示词原样发送，一次一图，重复提交不重复请求，图片可加入草稿",
      async () => {
        globalThis.fetch = modelFetch;
        const { input, id } = await submit();
        generatedId = id;
        assert.equal(
          (await generate(request("/api/images", "POST", input))).status,
          202,
        );
        assert.equal(
          (
            await generate(
              request("/api/images", "POST", {
                ...input,
                settings: { prompt: "changed" },
              }),
            )
          ).status,
          409,
        );
        const owner = randomUUID();
        assert.ok(acquireWorker(owner));
        assert.equal(acquireWorker("other-worker"), false);
        const job = claimJob(owner)!;
        assert.equal(job.id, id);
        assert.equal(claimJob(owner), undefined);
        await executeJob(job);
        releaseWorker(owner);
        assert.equal(modelCalls, 1);
        const result = db().select().from(jobs).where(eq(jobs.id, id)).get()!;
        assert.equal(result.status, "succeeded");
        assert.equal(result.result?.width, 80);
        assert.equal(result.result?.height, 120);
        const current = db().select().from(workspaces).get()!;
        current.apps[0].drafts["apple:en-US"].images = [
          String(result.result?.url),
        ];
        assert.equal(
          (
            await saveApps(
              request("/api/apps", "PUT", {
                revision: current.revision,
                apps: current.apps,
              }),
            )
          ).status,
          200,
        );
        const listing = await getImages(
          request(`/api/images?${new URLSearchParams(target)}`),
        );
        assert.equal((await listing.json()).images[0].id, id);
        const otherLocale = await getImages(
          request(
            `/api/images?${new URLSearchParams({ ...target, locale: "zh-Hans" })}`,
          ),
        );
        assert.equal((await otherLocale.json()).images.length, 0);
        const edit = await submit([reference.url]);
        const owner2 = randomUUID();
        assert.ok(acquireWorker(owner2));
        await executeJob(claimJob(owner2)!);
        releaseWorker(owner2);
        assert.equal(
          db().select().from(jobs).where(eq(jobs.id, edit.id)).get()?.status,
          "succeeded",
        );
        assert.equal(modelCalls, 2);
      },
    );
    await t.test("多选截图逐张生成，素材共享，重复提交不增加任务", async () => {
      const second = await sharp(bytes).resize(40, 60).png().toBuffer();
      const material = await sharp(bytes).resize(20, 30).png().toBuffer();
      const input = {
        ...target,
        requestId: randomUUID(),
        deviceGroup: "IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY",
        screenshots: [reference.url, (await storeAsset(second)).url],
        settings: {
          prompt: "batch",
          modelSize: "1179x2556",
          references: [(await storeAsset(material)).url],
        },
      };
      for (let attempt = 0; attempt < 2; attempt++)
        assert.equal(
          (await generate(request("/api/images", "POST", input))).status,
          202,
        );
      const owner = randomUUID();
      assert.ok(acquireWorker(owner));
      const seen = new Set();
      try {
        for (let i = 0; i < 2; i++) {
          const job = claimJob(owner)!;
          const index = Number(job.input.screenshotIndex);
          seen.add(index);
          globalThis.fetch = async (_url, init) => {
            assert.ok(init?.body instanceof FormData);
            const files = init.body.getAll("image[]") as File[];
            assert.equal(files.length, 2);
            assert.deepEqual(
              Buffer.from(await files[0].arrayBuffer()),
              [bytes, second][index],
            );
            assert.deepEqual(
              Buffer.from(await files[1].arrayBuffer()),
              material,
            );
            return Response.json({
              data: [{ b64_json: bytes.toString("base64") }],
            });
          };
          await executeJob(job);
          assert.equal(
            db().select().from(jobs).where(eq(jobs.id, job.id)).get()?.status,
            "succeeded",
          );
        }
        for (const [deviceGroup, modelSize, count] of [
          [input.deviceGroup, input.settings.modelSize, 2],
          [input.deviceGroup, "2556x1179", 0],
          ["IPHONE_DUO", input.settings.modelSize, 0],
        ] as const) {
          const response = await getImages(
            request(
              "/api/images?" +
                new URLSearchParams({ ...target, deviceGroup, modelSize }),
            ),
          );
          assert.equal((await response.json()).images.length, count);
        }
        assert.deepEqual(seen, new Set([0, 1]));
        assert.equal(claimJob(owner), undefined);
      } finally {
        releaseWorker(owner);
      }
    });
    await t.test(
      "网络结果未知不会重发；有响应可重启恢复，无响应保持未知",
      async () => {
        globalThis.fetch = async () => {
          modelCalls++;
          throw new Error("fixture-key");
        };
        const { id } = await submit();
        const owner = randomUUID();
        assert.ok(acquireWorker(owner));
        await executeJob(claimJob(owner)!);
        releaseWorker(owner);
        assert.equal(
          db().select().from(jobs).where(eq(jobs.id, id)).get()?.status,
          "uncertain",
        );
        const callsBefore = modelCalls;
        const recoverable = await submit();
        const unknown = await submit();
        db()
          .update(jobs)
          .set({ status: "running", result: { sent: true } })
          .where(eq(jobs.id, recoverable.id))
          .run();
        db()
          .update(jobs)
          .set({ status: "running", result: { sent: true } })
          .where(eq(jobs.id, unknown.id))
          .run();
        await checkpointReply(recoverable.id, {
          b64_json: bytes.toString("base64"),
        });
        closeDb();
        await recoverJobs();
        assert.equal(
          db().select().from(jobs).where(eq(jobs.id, unknown.id)).get()?.status,
          "uncertain",
        );
        const owner2 = randomUUID();
        assert.ok(acquireWorker(owner2));
        const job = claimJob(owner2)!;
        assert.equal(job.id, recoverable.id);
        await executeJob(job);
        releaseWorker(owner2);
        assert.equal(
          db().select().from(jobs).where(eq(jobs.id, recoverable.id)).get()
            ?.status,
          "succeeded",
        );
        assert.equal(modelCalls, callsBefore);
        assert.equal(
          (
            await removeImage(request(`/api/images/${generatedId}`, "DELETE"), {
              params: Promise.resolve({ id: generatedId }),
            })
          ).status,
          200,
        );
        // Removing generation history keeps already selected assets readable.
        assert.equal(
          (
            await getAsset(request(reference.url), {
              params: Promise.resolve({ id: reference.id }),
            })
          ).status,
          200,
        );
      },
    );
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
        db()
          .update(jobs)
          .set({ status: "running" })
          .where(eq(jobs.id, id))
          .run();
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
    await t.test(
      "Apple 商店资料同步保存截图和元数据，保留本地草稿及前次快照",
      async () => {
        await saveConfig(
          "apple",
          appId,
          0,
          { ...appleConfig.fields, version: "" },
          appleConfig.secret,
        );
        globalThis.fetch = mockApple({ screenshots: true });
        const response = await pullApple(
          request("/api/apple-sync", "POST", { appId }),
        );
        assert.equal(response.status, 202, await response.clone().text());
        const owner = randomUUID();
        assert.ok(acquireWorker(owner));
        await pullAppleTask(claimJob(owner)!, async () => bytes);
        releaseWorker(owner);
        const first = db()
          .select()
          .from(storeSnapshots)
          .where(eq(storeSnapshots.app_id, appId))
          .get()!;
        assert.equal(
          first.current_snapshot.locales["en-US"].draft.title,
          "Remote",
        );
        assert.equal(
          first.current_snapshot.locales["en-US"].screenshots.length,
          2,
        );
        assert.match(
          first.current_snapshot.locales["en-US"].screenshots[0].url!,
          /^\/api\/assets\//,
        );
        globalThis.fetch = mockApple({ title: "Changed", screenshots: true });
        assert.equal(
          (await pullApple(request("/api/apple-sync", "POST", { appId })))
            .status,
          202,
        );
        const owner2 = randomUUID();
        assert.ok(acquireWorker(owner2));
        await pullAppleTask(claimJob(owner2)!, async () => {
          throw new Error("Cached images must be reused");
        });
        releaseWorker(owner2);
        const second = db()
          .select()
          .from(storeSnapshots)
          .where(eq(storeSnapshots.app_id, appId))
          .get()!;
        assert.equal(
          second.previous_snapshot?.locales["en-US"].draft.title,
          "Remote",
        );
        assert.equal(
          second.current_snapshot.locales["en-US"].draft.title,
          "Changed",
        );
        assert.equal(
          db().select().from(workspaces).get()?.apps[0].drafts["apple:en-US"]
            .title,
          "Test",
        );
        // A failed image transfer must not replace a complete metadata + image snapshot.
        globalThis.fetch = async (input, init) => {
          const response = await mockApple({
            title: "Should not be saved",
            screenshots: true,
          })(input, init);
          const body = await response.json();
          for (const image of body.included ?? [])
            if (image.attributes?.imageAsset)
              image.attributes.imageAsset.templateUrl =
                image.attributes.imageAsset.templateUrl.replace(
                  "/image/thumb/",
                  "/image/thumb/new/",
                );
          return Response.json(body);
        };
        assert.equal(
          (await pullApple(request("/api/apple-sync", "POST", { appId })))
            .status,
          202,
        );
        const owner3 = randomUUID();
        assert.ok(acquireWorker(owner3));
        const failed = claimJob(owner3)!;
        await pullAppleTask(failed, async () => {
          throw new Error("download failed");
        });
        releaseWorker(owner3);
        assert.equal(
          db().select().from(jobs).where(eq(jobs.id, failed.id)).get()?.status,
          "failed",
        );
        assert.equal(
          db()
            .select()
            .from(storeSnapshots)
            .where(eq(storeSnapshots.app_id, appId))
            .get()?.current_snapshot.locales["en-US"].draft.title,
          "Changed",
        );
      },
    );
    await t.test(
      "Google 快照保存本地化文案和分组截图，失败时保留完整快照",
      async () => {
        const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
          .privateKey.export({ format: "pem", type: "pkcs8" })
          .toString();
        await saveConfig(
          "google",
          appId,
          1,
          { packageName: app.google },
          JSON.stringify({
            type: "service_account",
            client_email: "test@project.iam.gserviceaccount.com",
            private_key: privateKey,
          }),
        );
        let fail = false;
        let deleted = 0;
        globalThis.fetch = async (input, init) => {
          const url = String(input);
          if (url.endsWith("/token"))
            return Response.json({ access_token: "test" });
          if (url.endsWith("/edits") && init?.method === "POST")
            return Response.json({ id: "abc" });
          if (url.endsWith("/edits/abc") && init?.method === "DELETE") {
            deleted++;
            return new Response(null, { status: 204 });
          }
          if (url.endsWith("/listings"))
            return Response.json({
              listings: [
                {
                  language: "en-US",
                  title: "Play",
                  shortDescription: "Short",
                  fullDescription: "Full",
                  video: "https://youtu.be/example",
                },
              ],
            });
          if (url.endsWith("/en-US/phoneScreenshots"))
            return fail
              ? new Response(null, { status: 403 })
              : Response.json({
                  images: [{ id: "shot", url: "https://example.com/shot" }],
                });
          assert.match(
            url,
            /\/en-US\/(sevenInchScreenshots|tenInchScreenshots|tvScreenshots|wearScreenshots)$/,
          );
          return Response.json({});
        };
        for (const shouldFail of [false, true]) {
          fail = shouldFail;
          const queue = () =>
            queueGoogle(request("/api/google-sync", "POST", { appId }));
          assert.equal((await queue()).status, 202);
          assert.equal((await queue()).status, 409);
          const owner = randomUUID();
          assert.ok(acquireWorker(owner));
          try {
            await pullGoogleTask(claimJob(owner)!, async () => bytes);
          } finally {
            releaseWorker(owner);
          }
          const state = await (
            await googleState(request("/api/google-sync?appId=" + appId))
          ).json();
          assert.equal(state.job.status, fail ? "failed" : "succeeded");
          const entry = state.snapshot.locales["en-US"];
          assert.equal(entry.draft.subtitle, "Short");
          assert.equal(entry.draft.video, "https://youtu.be/example");
          assert.equal(entry.screenshots[0].deviceType, "phoneScreenshots");
          assert.match(entry.screenshots[0].url, /^\/api\/assets\//);
          assert.equal(
            db().select().from(workspaces).get()?.apps[0].drafts["google:en-US"]
              .title,
            "Test",
          );
          assert.equal(
            db().select().from(storeSnapshots).get()?.current_snapshot.locales[
              "en-US"
            ].draft.title,
            "Changed",
          );
        }
        assert.equal(deleted, 2);
      },
    );
    sqlite().pragma("integrity_check");
  } finally {
    globalThis.fetch = originalFetch;
    closeDb();
    await rm(directory, { recursive: true, force: true });
  }
});
