import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../lib/db";
import { jobs, workspaces, storeSnapshots } from "../lib/schema";
import { saveConfig } from "../lib/config-store";
import {
  acquireWorker,
  claimJob,
  recoverJobs,
  releaseWorker,
} from "../lib/worker";
import {
  POST as queueGoogle,
  GET as googleState,
} from "../app/api/google-sync/route";
import { pullGoogleTask } from "../lib/google-sync-task";
import { pullAppleTask } from "../lib/apple-sync-task";
import { GET as getApps, PUT as saveApps } from "../app/api/apps/route";
import { POST as pushStore } from "../app/api/store-push/route";
import { POST as pullApple } from "../app/api/apple-sync/route";
import { config as appleConfig, mockApple } from "./apple-sync-fixtures";

import { workflowFixture } from "./workflow-fixture";
test("商店同步、推送与主语言保护", async (t) => {
  const { appId, app, draft, request, seedWorkspace } =
    await workflowFixture(t);
  await seedWorkspace();
  const bytes = await sharp({
    create: { width: 80, height: 120, channels: 3, background: "#168766" },
  })
    .png()
    .toBuffer();
  const before = await (await getApps(request("/api/apps"))).json();
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
        (await pullApple(request("/api/apple-sync", "POST", { appId }))).status,
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
      assert.match(second.current_snapshot.icon?.url ?? "", /^\/api\/assets\//);
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
        (await pullApple(request("/api/apple-sync", "POST", { appId }))).status,
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
  await t.test("Apple 拉取期间更换 Bundle ID 时保留原快照", async () => {
    globalThis.fetch = mockApple({ title: "过期的目标", screenshots: true });
    assert.equal(
      (await pullApple(request("/api/apple-sync", "POST", { appId }))).status,
      202,
    );
    const owner = randomUUID();
    assert.ok(acquireWorker(owner));
    const job = claimJob(owner)!;
    const row = db().select().from(workspaces).get()!;
    try {
      db()
        .update(workspaces)
        .set({ apps: row.apps.map((a) => ({ ...a, apple: "changed.bundle" })) })
        .where(eq(workspaces.id, "default"))
        .run();
      await pullAppleTask(job, async () => bytes);
      assert.equal(
        db().select().from(jobs).where(eq(jobs.id, job.id)).get()?.status,
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
    } finally {
      releaseWorker(owner);
      db()
        .update(workspaces)
        .set({ apps: row.apps })
        .where(eq(workspaces.id, "default"))
        .run();
    }
  });
  await t.test(
    "Google 快照保存本地化文案和分组截图，失败时保留完整快照",
    async () => {
      const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
        .privateKey.export({ format: "pem", type: "pkcs8" })
        .toString();
      await saveConfig(
        "google",
        appId,
        0,
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
  const iconsChanged = await getApps(
    request("/api/apps?version=" + before.readVersion),
  );
  assert.equal(iconsChanged.status, 200);
  const fresh = await iconsChanged.json();
  assert.equal(fresh.revision, before.revision);
  assert.notEqual(fresh.readVersion, before.readVersion);
  assert.equal(
    (await getApps(request("/api/apps?version=" + fresh.readVersion))).status,
    204,
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
  const row = db().select().from(workspaces).get()!;
  row.apps[0].drafts["apple:en-AU"] = { ...draft };
  assert.equal((await saveApps(request("/api/apps", "PUT", row))).status, 200);
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

  const changed = await getApps(
    request("/api/apps?version=" + before.readVersion),
  );
  assert.equal(changed.status, 200);
});
