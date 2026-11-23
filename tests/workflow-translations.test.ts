import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { jobs, workspaces } from "../lib/schema";
import { saveConfig, readConfig } from "../lib/config-store";
import { storeAsset } from "../lib/storage";
import { executeJob } from "../lib/tasks";
import { PUT as saveApps } from "../app/api/apps/route";
import { POST as translate } from "../app/api/translations/route";

import { workflowFixture } from "./workflow-fixture";
test("翻译、修订冲突与模型降级", async (t) => {
  const { appId, draft, request, seedWorkspace, configureImages } =
    await workflowFixture(t);
  await seedWorkspace();
  await configureImages();
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
      assert.deepEqual(workspace().apps[0].drafts["google:fr-FR"], translated);
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
      assert.deepEqual(workspace().apps[0].drafts["google:fr-FR"], translated);
      const pending = await submit(["fr-FR"], "update", ["video"]);
      const changed = workspace();
      changed.apps[0].drafts["google:fr-FR"].title = "Manual";
      assert.equal(
        (await saveApps(request("/api/apps", "PUT", changed))).status,
        200,
      );
      assert.equal((await run((await pending.json()).ids[0])).status, "failed");
      assert.equal(workspace().apps[0].drafts["google:fr-FR"].title, "Manual");
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
      await executeJob(db().select().from(jobs).where(eq(jobs.id, id)).get()!);
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
});
