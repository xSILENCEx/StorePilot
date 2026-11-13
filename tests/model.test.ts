import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceSchema, validateDraft } from "../lib/model";
const draft = {
  title: "",
  subtitle: "",
  description: "",
  keywords: "",
  images: [],
};
test("草稿拒绝远端 URL 和内嵌图片，素材必须由本机服务管理", () => {
  const app = {
    id: crypto.randomUUID(),
    name: "Test",
    apple: "com.test",
    google: "",
    drafts: {
      "apple:en-US": { ...draft, images: ["https://example.com/image.png"] },
    },
  };
  assert.equal(
    workspaceSchema.safeParse({ revision: 0, apps: [app] }).success,
    false,
  );
});
test("拒绝未启用平台的空应用和重复 ID", () => {
  const app = {
    id: crypto.randomUUID(),
    name: "Test",
    apple: "com.test",
    google: "",
    drafts: {},
  };
  assert.equal(
    workspaceSchema.safeParse({ revision: 0, apps: [app, app] }).success,
    false,
  );
  assert.equal(
    workspaceSchema.safeParse({ revision: 0, apps: [{ ...app, apple: "" }] })
      .success,
    false,
  );
});
test("平台字段限制独立，关键词按字节校验", () => {
  assert.equal(
    validateDraft("apple", { ...draft, subtitle: "a".repeat(31) }).length,
    1,
  );
  assert.equal(
    validateDraft("google", { ...draft, subtitle: "a".repeat(31) }).length,
    0,
  );
  assert.equal(
    validateDraft("apple", { ...draft, keywords: "中".repeat(34) }).length,
    1,
  );
});
