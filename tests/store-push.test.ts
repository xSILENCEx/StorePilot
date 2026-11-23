import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { pushApple } from "../lib/apple-push";
import { pushGoogle } from "../lib/google-push";
import { pushContent } from "../lib/push-plan";
import { mockApple, config } from "./apple-sync-fixtures";
const asset = async () => ({ bytes: Buffer.from("test"), mime: "image/png" });
const silent = () => {};
const appleGroup = "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE";
test("推送计划跳过空字段、Google 内部备注和历史 TV 资源", () => {
  const result = pushContent(
    "google",
    {
      title: "Demo",
      subtitle: "",
      description: "",
      keywords: "private",
      images: [],
      graphics: { tvBanner: "old", icon: "icon" },
    },
    ["text", "graphics"],
  );
  assert.deepEqual(result, {
    fields: { title: "Demo" },
    groups: { icon: ["icon"] },
    errors: [],
  });
});
test("Apple 在可编辑版本分层更新文案、分片上传、放置和排序", async () => {
  const actions: string[] = [];
  const read = mockApple({ screenshots: true });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.hostname === "uploads.example") {
      assert.equal(method, "PUT");
      assert.equal(new Headers(init?.headers).has("Authorization"), false);
      assert.equal(Buffer.from(init?.body as Uint8Array).toString(), "test");
      actions.push("part");
      return new Response(null, { status: 200 });
    }
    const path = url.pathname.slice(4);
    if (method === "GET" && !path.endsWith("assetLibrary"))
      return read(input, init);
    actions.push(method + " " + path);
    const body = init?.body ? JSON.parse(String(init.body)).data : null;
    if (path.endsWith("/assetLibrary"))
      return Response.json({ data: { id: "library" } });
    if (path === "appAssetLibraryImages")
      return Response.json({
        data: {
          id: "image",
          attributes: {
            uploadOperations: [
              {
                url: "https://uploads.example/put",
                method: "PUT",
                offset: 0,
                length: 4,
              },
            ],
          },
        },
      });
    if (path === "appAssetLibraryImages/image")
      return Response.json({
        data: { id: "image", attributes: { state: "COMPLETE" } },
      });
    if (path === "appAssetLibraryPlacements")
      return Response.json({ data: { id: "newPlacement" } });
    if (path === "appInfoLocalizations/il1")
      assert.deepEqual(body.attributes, { name: "New name" });
    if (path === "appStoreVersionLocalizations/vl1")
      assert.deepEqual(body.attributes, { description: "New description" });
    if (path === "appAssetLibraryPlacementOrderingRequests")
      assert.deepEqual(body.relationships.orderedPlacements.data, [
        { type: "appAssetLibraryPlacements", id: "newPlacement" },
      ]);
    return Response.json({});
  };
  await pushApple(
    config,
    [
      {
        locale: "en-US",
        fields: { title: "New name", description: "New description" },
        groups: { [appleGroup]: ["src"] },
        errors: [],
      },
    ],
    asset,
    silent,
    fetcher,
  );
  assert.deepEqual(actions, [
    "PATCH appInfoLocalizations/il1",
    "PATCH appStoreVersionLocalizations/vl1",
    "GET apps/123/assetLibrary",
    "POST appAssetLibraryImages",
    "part",
    "PATCH appAssetLibraryImages/image",
    "DELETE appAssetLibraryPlacements/placement-1",
    "POST appAssetLibraryPlacements",
    "POST appAssetLibraryPlacementOrderingRequests",
  ]);
});
test("Apple 拒绝向已发布版本推送", async () => {
  await assert.rejects(
    pushApple(
      config,
      [],
      asset,
      silent,
      mockApple({
        versions: [
          {
            id: "live",
            attributes: {
              platform: "IOS",
              versionString: "1.0",
              appVersionState: "READY_FOR_DISTRIBUTION",
            },
          },
        ],
      }),
    ),
    /可编辑版本/,
  );
});
test("Google 在同一 edit 保留未选字段、替换并提交图片，上传失败清理 edit", async () => {
  const secret = JSON.stringify({
    client_email: "test@example.com",
    private_key: generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  for (const fail of [false, true]) {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input)),
        method = init?.method ?? "GET";
      calls.push(method + " " + url.pathname);
      if (url.pathname.endsWith("/token"))
        return Response.json({ access_token: "test" });
      if (url.pathname.endsWith("/edits")) return Response.json({ id: "edit" });
      if (url.pathname.endsWith("/listings"))
        return Response.json({
          listings: [
            {
              language: "en-US",
              title: "Old",
              shortDescription: "Keep",
              fullDescription: "Description",
            },
          ],
        });
      if (method === "PUT")
        assert.deepEqual(JSON.parse(String(init?.body)), {
          language: "en-US",
          title: "New",
          shortDescription: "Keep",
          fullDescription: "Description",
        });
      if (url.pathname.startsWith("/upload/"))
        return fail
          ? new Response(null, { status: 403 })
          : Response.json({ image: { id: "image" } });
      if (url.pathname.endsWith(":commit"))
        assert.equal(
          url.searchParams.get("changesInReviewBehavior"),
          "ERROR_IF_IN_REVIEW",
        );
      return Response.json({});
    };
    const action = pushGoogle(
      "test.app",
      secret,
      [
        {
          locale: "en-US",
          fields: { title: "New" },
          groups: { phoneScreenshots: ["src"] },
          errors: [],
        },
      ],
      asset,
      silent,
      fetcher,
    );
    if (fail) {
      await assert.rejects(action);
      assert.match(calls.at(-1)!, /^DELETE .*\/edits\/edit$/);
      assert.ok(!calls.some((c) => c.endsWith(":commit")));
    } else {
      await action;
      assert.match(calls.at(-2)!, /:validate$/);
      assert.match(calls.at(-1)!, /:commit$/);
    }
  }
});
