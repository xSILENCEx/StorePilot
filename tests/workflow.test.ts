import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { POST as pushStore } from "../app/api/store-push/route";
import { POST as translate } from "../app/api/translations/route";
import { POST as archive } from "../app/api/assets/archive/route";
import { POST as uploadAsset } from "../app/api/assets/route";
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
    await t.test(
      "上传和已有素材转为商店图片时按目标校验，拒绝放大",
      async () => {
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
      },
    );
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
      "Apple 商店资料同步保存截图和元数据，覆盖快照并保留本地草稿",
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
        assert.match(
          second.current_snapshot.icon?.url ?? "",
          /^\/api\/assets\//,
        );
        assert.equal(Object.hasOwn(second, "previous_snapshot"), false);
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
          if (url.endsWith("/edits/abc/details"))
            return Response.json({
              defaultLanguage: "en-US",
              contactEmail: "support@example.com",
              contactWebsite: "https://example.com",
            });
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
          if (url.endsWith("/icon") || url.endsWith("/featureGraphic"))
            return Response.json({
              images: [
                {
                  id: "graphic",
                  url:
                    "https://lh3.googleusercontent.com" + new URL(url).pathname,
                },
              ],
            });
          assert.match(
            url,
            /\/en-US\/(sevenInchScreenshots|tenInchScreenshots)$/,
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
          assert.deepEqual(state.snapshot.details, {
            defaultLanguage: "en-US",
            contactEmail: "support@example.com",
            contactWebsite: "https://example.com",
          });
          assert.match(state.snapshot.icon.url, /^\/api\/assets\//);
          assert.equal(state.snapshot.icon.url, entry.graphics.icon.url);
          assert.ok(entry.graphics.featureGraphic.url);
          assert.ok(entry.graphics.featureGraphic.sourceUrl.endsWith("=s0"));
          const workspace = await (await getApps(request("/api/apps"))).json();
          assert.equal(
            workspace.apps[0].platformIcons.google,
            state.snapshot.icon.url,
          );
          assert.ok(workspace.apps[0].platformIcons.apple);
          assert.equal(entry.screenshots.length, 1);
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
    await t.test("批量下载保留目录、顺序和图片原始内容", async () => {
      const response = await archive(
        request("/api/assets/archive", "POST", {
          appId,
          platform: "google",
          locale: "en-US",
          group: "手机截图",
          items: [{ url: reference.url }, { url: reference.url }],
        }),
      );
      assert.equal(response.status, 200);
      const file = path.join(directory, "images.zip");
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
      const inspect = spawnSync("python3", [
        "-c",
        [
          "import json, sys, zipfile",
          "with zipfile.ZipFile(sys.argv[1]) as archive:",
          "    print(json.dumps([[n, archive.read(n).hex()] for n in archive.namelist()]))",
        ].join("\n"),
        file,
      ]);
      assert.equal(inspect.status, 0, inspect.stderr.toString());
      assert.deepEqual(
        JSON.parse(inspect.stdout.toString()),
        ["01", "02"].map((index) => [
          `GooglePlay_en-US_80x120/${index}_手机截图_80x120.png`,
          bytes.toString("hex"),
        ]),
      );
    });
    await t.test(
      "批量翻译按语言独立提交，细选覆盖，失败或并发编辑保留原草稿",
      async () => {
        const workspace = () => db().select().from(workspaces).get()!;
        const row = workspace();
        const drafts = row.apps[0].drafts;
        const icon = await sharp({
          create: { width: 512, height: 512, channels: 3, background: "red" },
        })
          .png()
          .toBuffer();
        const localized = await sharp(icon).negate().png().toBuffer();
        drafts["google:en-US"] = {
          ...draft,
          description: "Original",
          video: "https://example.com/video",
          graphics: { icon: (await storeAsset(icon)).url },
        };
        assert.equal(
          (
            await saveApps(
              request("/api/apps", "PUT", {
                apps: row.apps,
                revision: row.revision,
              }),
            )
          ).status,
          200,
        );
        await saveConfig(
          "text",
          undefined,
          0,
          {
            baseUrl: "https://text.example/v1",
            model: "text-model",
            timeoutSeconds: 30,
          },
          "test-only",
        );
        let calls = 0;
        globalThis.fetch = async (url, init) => {
          if (String(url).endsWith("/images/edits")) {
            assert.ok(
              init?.body instanceof FormData &&
                init.body.get("image") instanceof Blob,
            );
            return Response.json({
              data: [{ b64_json: localized.toString("base64") }],
            });
          }
          assert.equal(String(url), "https://text.example/v1/chat/completions");
          const payload = JSON.parse(
            JSON.parse(String(init?.body)).messages[1].content,
          );
          assert.deepEqual(payload.fields, { title: "Test" });
          calls++;
          if (payload.target === "de-DE") return Response.json({ choices: [] });
          return Response.json({
            choices: [
              { message: { content: JSON.stringify({ title: "Titre" }) } },
            ],
          });
        };
        const submit = (
          targets: string[],
          mode = "add",
          selected = ["title", "graphic:icon", "video"],
        ) =>
          translate(
            request("/api/translations", "POST", {
              appId,
              platform: "google",
              mode,
              source: "en-US",
              targets,
              selected,
              revision: workspace().revision,
            }),
          );
        assert.equal((await submit(["en-US"])).status, 400);
        const response = await submit(["fr-FR", "de-DE"]);
        assert.equal(response.status, 202);
        assert.equal((await submit(["fr-FR"])).status, 409);
        const run = async (id: string) => {
          const job = db().select().from(jobs).where(eq(jobs.id, id)).get()!;
          await executeJob(job);
          return db().select().from(jobs).where(eq(jobs.id, id)).get()!;
        };
        const { ids } = await response.json();
        assert.equal((await run(ids[0])).status, "succeeded");
        assert.equal((await run(ids[1])).status, "failed");
        assert.equal(calls, 2);
        const translated = workspace().apps[0].drafts["google:fr-FR"];
        assert.equal(translated.title, "Titre");
        assert.equal(translated.description, "");
        assert.equal(translated.video, "https://example.com/video");
        assert.ok(
          translated.graphics?.icon &&
            translated.graphics.icon !== drafts["google:en-US"].graphics?.icon,
        );
        assert.equal(workspace().apps[0].drafts["google:de-DE"], undefined);
        assert.equal((await submit(["fr-FR"])).status, 400);
        const update = await submit(["fr-FR"], "update", ["video"]);
        assert.equal(update.status, 202);
        assert.equal(
          (await run((await update.json()).ids[0])).status,
          "succeeded",
        );
        assert.deepEqual(
          workspace().apps[0].drafts["google:fr-FR"],
          translated,
        );
        const invalidImage = await submit(["fr-FR"], "update", [
          "title",
          "graphic:icon",
        ]);
        const modelFetch = globalThis.fetch;
        globalThis.fetch = async (url, init) =>
          String(url).endsWith("/images/edits")
            ? Response.json({
                data: [
                  { b64_json: Buffer.from("invalid image").toString("base64") },
                ],
              })
            : modelFetch(url, init);
        assert.equal(
          (await run((await invalidImage.json()).ids[0])).status,
          "failed",
        );
        assert.deepEqual(
          workspace().apps[0].drafts["google:fr-FR"],
          translated,
        );
        const pending = await submit(["fr-FR"], "update", ["video"]);
        const changed = workspace();
        changed.apps[0].drafts["google:fr-FR"].title = "Manual";
        assert.equal(
          (await saveApps(request("/api/apps", "PUT", changed))).status,
          200,
        );
        assert.equal(
          (await run((await pending.json()).ids[0])).status,
          "failed",
        );
        assert.equal(
          workspace().apps[0].drafts["google:fr-FR"].title,
          "Manual",
        );
      },
    );
    await t.test("Apple 副标题超限时只改写副标题，并再次校验长度", async () => {
      const row = db().select().from(workspaces).get()!;
      row.apps[0].drafts["apple:en-US"].subtitle = "Stay active";
      assert.equal(
        (await saveApps(request("/api/apps", "PUT", row))).status,
        200,
      );
      const queued = await translate(
        request("/api/translations", "POST", {
          appId,
          platform: "apple",
          source: "en-US",
          mode: "add",
          targets: ["en-AU"],
          selected: ["title", "subtitle"],
          revision: row.revision + 1,
        }),
      );
      assert.equal(queued.status, 202);
      const id = (await queued.json()).ids[0];
      let calls = 0;
      globalThis.fetch = async (_, init) => {
        const { messages } = JSON.parse(String(init?.body));
        const { fields, previous } = JSON.parse(messages[1].content);
        assert.match(messages[0].content, /subtitle: at most 30 characters/);
        if (calls++ === 0) {
          assert.match(messages[0].content, /title: 2 to 30 characters/);
          return Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: fields.title,
                    subtitle: "a".repeat(31),
                  }),
                },
              },
            ],
          });
        }
        assert.deepEqual(Object.keys(fields), ["subtitle"]);
        assert.equal(previous.subtitle.length, 31);
        return Response.json({
          choices: [{ message: { content: '{"subtitle":"Stay active"}' } }],
        });
      };
      await executeJob(db().select().from(jobs).where(eq(jobs.id, id)).get()!);
      assert.equal(calls, 2);
      assert.equal(
        db().select().from(workspaces).get()!.apps[0].drafts["apple:en-AU"]
          .subtitle,
        "Stay active",
      );
    });
    await t.test(
      "文本和截图模型分别按优先级降级，成功后不再调用后续模型",
      async () => {
        for (const scope of ["text", "image"] as const) {
          const config = await readConfig(scope);
          await saveConfig(scope, undefined, config.revision, {
            ...config.fields,
            model: scope + "-1",
            fallbackModel: scope + "-2",
            secondFallbackModel: scope + "-3",
          });
        }
        const row = db().select().from(workspaces).get()!;
        const response = await translate(
          request("/api/translations", "POST", {
            appId,
            platform: "google",
            mode: "add",
            source: "en-US",
            targets: ["de-DE"],
            selected: ["title", "graphic:icon"],
            revision: row.revision,
          }),
        );
        assert.equal(response.status, 202);
        const id = (await response.json()).ids[0];
        const calls: string[] = [];
        const png = await sharp({
          create: { width: 512, height: 512, channels: 3, background: "green" },
        })
          .png()
          .toBuffer();
        globalThis.fetch = async (_, init) => {
          const model =
            init?.body instanceof FormData
              ? init.body.get("model")
              : JSON.parse(String(init?.body)).model;
          calls.push(String(model));
          if (model === "text-2")
            return Response.json({
              choices: [{ message: { content: '{"title":"Titel"}' } }],
            });
          if (model === "image-3")
            return Response.json({
              data: [{ b64_json: png.toString("base64") }],
            });
          return new Response(null, { status: 502 });
        };
        await executeJob(
          db().select().from(jobs).where(eq(jobs.id, id)).get()!,
        );
        assert.deepEqual(calls, [
          "text-1",
          "text-2",
          "image-1",
          "image-2",
          "image-3",
        ]);
        assert.equal(
          db().select().from(workspaces).get()!.apps[0].drafts["google:de-DE"]
            .title,
          "Titel",
        );
      },
    );
    await t.test(
      "推送固定已确认草稿，拒绝旧修订、并发重复推送，中断不自动重发",
      async () => {
        const row = db().select().from(workspaces).get()!;
        const body = {
          requestId: randomUUID(),
          appId,
          platform: "google",
          sections: ["text"],
          locales: ["en-US"],
          revision: row.revision,
        };
        const send = (input: object) =>
          pushStore(request("/api/store-push", "POST", input));
        assert.equal(
          (await send({ ...body, revision: row.revision - 1 })).status,
          409,
        );
        assert.equal((await send(body)).status, 202);
        assert.equal((await send(body)).status, 202);
        assert.equal(
          (await send({ ...body, requestId: randomUUID() })).status,
          409,
        );
        const job = db()
          .select()
          .from(jobs)
          .where(eq(jobs.id, body.requestId))
          .get()!;
        assert.equal(job.kind, "push_store");
        assert.deepEqual(
          (job.input.entries as { locale: string }[]).map((e) => e.locale),
          ["en-US"],
        );
        db()
          .update(jobs)
          .set({ status: "running" })
          .where(eq(jobs.id, job.id))
          .run();
        await recoverJobs();
        assert.equal(
          db().select().from(jobs).where(eq(jobs.id, job.id)).get()?.status,
          "uncertain",
        );
      },
    );
    await t.test(
      "两个商店的主语言无法通过保存工作区删除，其他语言可删除",
      async () => {
        for (const platform of ["apple", "google"]) {
          const row = db().select().from(workspaces).get()!;
          delete row.apps[0].drafts[platform + ":en-US"];
          const response = await saveApps(request("/api/apps", "PUT", row));
          assert.equal(response.status, 409);
          assert.match((await response.json()).error, /商店主语言/);
        }
        const row = db().select().from(workspaces).get()!;
        delete row.apps[0].drafts["apple:en-AU"];
        assert.equal(
          (await saveApps(request("/api/apps", "PUT", row))).status,
          200,
        );
      },
    );
    sqlite().pragma("integrity_check");
  } finally {
    globalThis.fetch = originalFetch;
    closeDb();
    await rm(directory, { recursive: true, force: true });
  }
});
