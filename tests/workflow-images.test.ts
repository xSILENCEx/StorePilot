import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../lib/db";
import { jobs, workspaces } from "../lib/schema";
import { storeAsset } from "../lib/storage";
import {
  acquireWorker,
  claimJob,
  recoverJobs,
  releaseWorker,
} from "../lib/worker";
import { executeJob } from "../lib/tasks";
import { checkpointReply } from "../lib/image-provider";
import { PUT as saveApps } from "../app/api/apps/route";
import { GET as getImages, POST as generate } from "../app/api/images/route";
import { DELETE as removeImage } from "../app/api/images/[id]/route";
import { POST as archive } from "../app/api/assets/archive/route";
import { GET as getAsset } from "../app/api/assets/[id]/route";

import { workflowFixture } from "./workflow-fixture";
test("图片生成、恢复与素材下载", async (t) => {
  const { appId, request, origin, directory, seedWorkspace, configureImages } =
    await workflowFixture(t);
  await seedWorkspace();
  await configureImages();
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
          assert.deepEqual(Buffer.from(await files[1].arrayBuffer()), material);
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
});
