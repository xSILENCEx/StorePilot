import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";
import { getMigrations } from "better-auth/db/migration";
import { makeWorkerUtils, runOnce } from "graphile-worker";
import { pool } from "../lib/db";
import { auth } from "../lib/auth";
import { saveConfig } from "../lib/config-store";
import { storeAsset, assetPath } from "../lib/storage";
import { screenshotSettings } from "../lib/screenshot-model";
import { generateImageTask } from "../lib/image-task";
import {
  GET as getWorkspace,
  PUT as putWorkspace,
} from "../app/api/apps/route";
import { POST as createGroup } from "../app/api/screenshots/route";
import {
  GET as readGroup,
  PUT as saveGroup,
} from "../app/api/screenshots/[id]/route";
import { POST as enqueue } from "../app/api/screenshots/[id]/generate/route";
import { POST as adopt } from "../app/api/screenshots/[id]/adopt/route";
import { POST as uploadFinished } from "../app/api/screenshots/[id]/upload/route";
import {
  DELETE as hide,
  PUT as unhide,
} from "../app/api/screenshots/[id]/candidates/[candidateId]/route";
import { POST as resume } from "../app/api/screenshots/[id]/candidates/[candidateId]/resume/route";
loadEnvConfig(process.cwd());
const origin = "http://127.0.0.1:3000";
async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("先启动本机数据库并配置 DATABASE_URL");
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const name = `storepilot_image_test_${randomBytes(6).toString("hex")}`;
  const root = path.join(process.cwd(), "data", name);
  const originalFetch = globalThis.fetch;
  let created = false;
  try {
    await admin.query(`create database "${name}"`);
    created = true;
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = "/" + name;
    process.env.DATABASE_URL = url.href;
    process.env.STORAGE_PATH = path.join(root, "assets");
    process.env.STOREPILOT_MASTER_KEY = randomBytes(32).toString("base64");
    process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
    process.env.BETTER_AUTH_URL = origin;
    for (const migration of [
      "001_foundation",
      "002_configs",
      "003_verification",
      "004_screenshots",
      "005_screenshot_history",
    ])
      await pool().query(await readFile(`db/${migration}.sql`, "utf8"));
    const migration = await getMigrations(auth().options);
    await migration.runMigrations();
    const worker = await makeWorkerUtils({ pgPool: pool() });
    await worker.migrate();
    await worker.release();
    const credentials = {
      email: "image-test@example.test",
      password: randomBytes(24).toString("hex"),
    };
    await auth(true).api.signUpEmail({
      body: { ...credentials, name: "Image test" },
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
      .map((c) => c.split(";")[0])
      .join("; ");
    const headers = {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
    };
    function request(body?: unknown, method = "POST") {
      return new Request(
        origin + "/api/test",
        body === undefined
          ? { headers, method: "GET" }
          : { method, headers, body: JSON.stringify(body) },
      );
    }
    const appId = randomUUID();
    const draft = {
      title: "Fixture",
      subtitle: "",
      description: "",
      keywords: "",
      images: [],
    };
    await getWorkspace(request());
    const app = {
      id: appId,
      name: "隔离测试",
      apple: "com.test.image",
      google: "com.test.image",
      drafts: {
        "google:en-US": draft,
        "google:zh-Hans": draft,
        "apple:en-US": draft,
      },
    };
    assert.equal(
      (await putWorkspace(request({ revision: 0, apps: [app] }, "PUT"))).status,
      200,
    );
    const response = await createGroup(
      request({
        appId,
        platform: "google",
        locale: "en-US",
        device: "google-phone",
      }),
    );
    assert.equal(response.status, 200);
    let group = await response.json();
    const id = group.id;
    const context = { params: Promise.resolve({ id }) };
    const cross = await createGroup(
      request({
        appId,
        platform: "google",
        locale: "zh-Hans",
        device: "google-phone",
      }),
    );
    assert.notEqual((await cross.json()).id, id);
    assert.equal(
      (
        await createGroup(
          request({
            appId,
            platform: "google",
            locale: "en-US",
            device: "apple-iphone-large",
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (await readGroup(new Request(origin + "/api/test"), context)).status,
      401,
    );
    const svg = Buffer.from(
      `<svg width="390" height="844" xmlns="http://www.w3.org/2000/svg"><rect width="390" height="844" fill="#f6f8fa"/><rect width="390" height="130" fill="#167c66"/><text x="28" y="80" fill="white" font-size="30" font-family="Arial">StorePilot</text><rect x="20" y="160" width="350" height="150" rx="18" fill="white"/><text x="40" y="210" font-family="Arial" font-size="24" fill="#1e3b32">Your next great release</text><rect x="20" y="340" width="350" height="150" rx="18" fill="white"/><rect x="20" y="520" width="350" height="150" rx="18" fill="white"/></svg>`,
    );
    const source = await storeAsset(await sharp(svg).png().toBuffer());
    async function settings(patch: unknown) {
      group = await (
        await saveGroup(
          request(
            {
              revision: group.revision,
              settings: { ...group.settings, ...(patch as object) },
            },
            "PUT",
          ),
          context,
        )
      ).json();
      assert.ok(group.id, JSON.stringify(group));
      return group;
    }
    async function refresh() {
      group = await (await readGroup(request(), context)).json();
      return group;
    }
    async function generate(extra: Record<string, unknown> = {}) {
      const requestId = randomUUID();
      const input = { revision: group.revision, requestId, ...extra };
      const first = await enqueue(request(input), context);
      assert.equal(
        first.status,
        202,
        JSON.stringify(await first.clone().json()),
      );
      const candidate = await first.json();
      const repeat = await enqueue(request(input), context);
      assert.equal(repeat.status, 202);
      assert.equal((await repeat.json()).id, candidate.id);
      return candidate;
    }
    async function work() {
      await runOnce({
        pgPool: pool(),
        taskList: { generate_image: generateImageTask },
        concurrency: 1,
        noHandleSignals: true,
      });
      await refresh();
    }
    await settings(
      screenshotSettings.parse({
        mode: "template",
        screenshot: source.url,
        headline: "每一次上新，都从容有序",
        subtitle: "真实界面 · 清晰呈现产品价值",
      }),
    );
    const stale = await saveGroup(
      request({ revision: 1, settings: group.settings }, "PUT"),
      context,
    );
    assert.equal(stale.status, 409);
    const local = await generate();
    await work();
    let candidate = group.candidates.find(
      (c: { id: string }) => c.id === local.id,
    );
    assert.equal(candidate.status, "succeeded", candidate.error);
    const rendered = await readFile(assetPath(candidate.url.split("/").at(-1)));
    const meta = await sharp(rendered).metadata();
    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 1920);
    assert.equal(meta.hasAlpha, false);
    await mkdir("data/verification", { recursive: true, mode: 0o700 });
    await writeFile("data/verification/image-studio-template.png", rendered, {
      mode: 0o600,
    });
    async function adoption(input: unknown) {
      const response = await adopt(
        request({ revision: group.revision, ...(input as object) }),
        context,
      );
      assert.equal(
        response.status,
        200,
        JSON.stringify(await response.clone().json()),
      );
      group = await response.json();
    }
    await adoption({ action: "append", candidateId: local.id });
    assert.equal(group.adopted.length, 1);
    assert.ok(group.has_previous);
    await adoption({ action: "restore" });
    assert.equal(group.adopted.length, 0);
    await adoption({ action: "restore" });
    assert.equal(group.adopted.length, 1);
    const candidateContext = (candidateId: string) => ({
      params: Promise.resolve({ id, candidateId }),
    });
    assert.equal(
      (await hide(request({}, "DELETE"), candidateContext(local.id))).status,
      409,
    );
    const wrong = await uploadFinished(request({ url: source.url }), context);
    assert.equal(wrong.status, 400);
    const uploaded = await uploadFinished(
      request({ url: candidate.url }),
      context,
    );
    assert.equal(uploaded.status, 201);
    const uploadedId = (await uploaded.json()).id;
    assert.equal(
      (await hide(request({}, "DELETE"), candidateContext(uploadedId))).status,
      200,
    );
    assert.equal(
      (await unhide(request({}, "PUT"), candidateContext(uploadedId))).status,
      200,
    );
    await saveConfig(
      "image",
      undefined,
      0,
      {
        model: "fixture-image",
        baseUrl: "https://fixture.invalid/v1",
        timeoutSeconds: 30,
        concurrency: 2,
      },
      "fixture-key",
    );
    const background = await sharp({
      create: { width: 1024, height: 1536, channels: 3, background: "#b5dcd0" },
    })
      .png()
      .toBuffer();
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      calls++;
      const multipart = init!.body instanceof FormData;
      assert.equal(
        String(input),
        `https://fixture.invalid/v1/images/${multipart ? "edits" : "generations"}`,
      );
      assert.ok(
        ["Bearer fixture-key", "Bearer changed-fixture-key"].includes(
          (init!.headers as Record<string, string>).Authorization,
        ),
      );
      if (multipart) {
        const body = init!.body as FormData;
        assert.equal(body.get("n"), "1");
        assert.ok(body.get("image") instanceof Blob);
      } else {
        const body = JSON.parse(init!.body as string);
        assert.equal(body.n, 1);
        assert.ok(!JSON.stringify(body).includes(source.url));
      }
      return Response.json({
        data: [{ b64_json: background.toString("base64") }],
      });
    };
    await settings({
      ...group.settings,
      mode: "template-ai",
      prompt: "soft green abstract background",
      headline: "一切尽在掌握",
    });
    const ai = await generate();
    await work();
    candidate = group.candidates.find((c: { id: string }) => c.id === ai.id);
    assert.equal(candidate.status, "succeeded", candidate.error);
    assert.equal(calls, 1);
    assert.equal(group.adopted[0].candidateId, local.id);
    assert.ok(candidate.has_raw);
    await settings({ ...group.settings, headline: "让每个版本更出色" });
    const rerender = await generate({ reuseCandidateId: ai.id });
    await work();
    assert.equal(
      group.candidates.find((c: { id: string }) => c.id === rerender.id).status,
      "succeeded",
    );
    assert.equal(calls, 1);
    await adoption({ action: "append", candidateId: ai.id });
    await adoption({ action: "reorder", order: [ai.id, local.id] });
    assert.equal(group.adopted[0].candidateId, ai.id);
    // 模拟已收到响应、尚未写入原图 / 成品时崩溃，恢复不能重新收费。
    await pool().query(
      "update image_candidates set status='failed',url=null,thumbnail=null,raw_url=null where id=$1",
      [ai.id],
    );
    await pool().query("update jobs set status='failed' where id=$1", [
      ai.job_id,
    ]);
    await saveConfig(
      "image",
      undefined,
      1,
      {
        model: "fixture-image",
        baseUrl: "https://fixture.invalid/v1",
        timeoutSeconds: 30,
        concurrency: 2,
      },
      "changed-fixture-key",
    );
    assert.equal(
      (await resume(request({}), candidateContext(ai.id))).status,
      202,
    );
    await work();
    assert.equal(
      group.candidates.find((c: { id: string }) => c.id === ai.id).status,
      "succeeded",
    );
    assert.equal(calls, 1);
    // 模拟发送过请求但响应丢失，重复执行任务也不能再次调用模型。
    await settings({
      ...group.settings,
      mode: "image-ai",
      screenshot: null,
      prompt: "simple background",
    });
    const uncertain = await generate();
    await pool().query(
      "insert into image_calls(candidate_id,status,config_revision) values($1,'started',2)",
      [uncertain.id],
    );
    await work();
    assert.equal(
      group.candidates.find((c: { id: string }) => c.id === uncertain.id)
        .status,
      "uncertain",
    );
    assert.equal(calls, 1);
    assert.equal(
      (await resume(request({}), candidateContext(uncertain.id))).status,
      409,
    );
    // 文案超出模板时拒绝输出截断文字；已有背景可用新文案重渲染。
    await settings({
      ...group.settings,
      mode: "template-ai",
      screenshot: source.url,
      headline: "很长的标题".repeat(18),
      subtitle: "很长的副文案".repeat(30),
    });
    const overflow = await generate({ reuseCandidateId: ai.id });
    await work();
    const overflowCandidate = group.candidates.find(
      (c: { id: string }) => c.id === overflow.id,
    );
    assert.equal(overflowCandidate.status, "failed");
    assert.match(overflowCandidate.error, /文案超出/);
    await settings({
      ...group.settings,
      headline: "清晰呈现",
      subtitle: "无需再次调用模型",
    });
    const recovered = await generate({ reuseCandidateId: overflow.id });
    await work();
    assert.equal(
      group.candidates.find((c: { id: string }) => c.id === recovered.id)
        .status,
      "succeeded",
    );
    assert.equal(calls, 1);
    await settings({
      ...group.settings,
      mode: "image-ai",
      screenshot: source.url,
      output: "jpeg",
      prompt: "polished reference image",
    });
    const edited = await generate();
    await work();
    const finished = group.candidates.find(
      (c: { id: string }) => c.id === edited.id,
    );
    assert.equal(finished.status, "succeeded", finished.error);
    const jpeg = await sharp(
      await readFile(assetPath(finished.url.split("/").at(-1))),
    ).metadata();
    assert.equal(jpeg.format, "jpeg");
    assert.equal(jpeg.width, 1080);
    assert.equal(jpeg.height, 1920);
    assert.equal(calls, 2);
    const changed = await generate();
    await saveConfig(
      "image",
      undefined,
      2,
      {
        model: "fixture-image",
        baseUrl: "https://fixture.invalid/v1",
        timeoutSeconds: 30,
        concurrency: 2,
      },
      "changed-again",
    );
    await work();
    const refused = group.candidates.find(
      (c: { id: string }) => c.id === changed.id,
    );
    assert.equal(refused.status, "failed");
    assert.match(refused.error, /配置已变更/);
    assert.equal(calls, 2);
    console.log(
      "通过：隔离数据库中的鉴权、设备/语言隔离、配置冲突、幂等入队、Graphile Worker、真实 Chromium 模板渲染、PNG尺寸/透明度复检、候选不覆盖采用、采用/排序/恢复空状态、成品校验、隐藏恢复、AI模拟生成、背景复用、响应恢复与防重复付费。未读取或修改用户资料/模型配置，未调用真实付费模型。",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (created) {
      await pool().end();
      await admin.query(`drop database "${name}" with (force)`);
    }
    await admin.end();
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
