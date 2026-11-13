import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { checkConnection } from "../lib/connection-check";
const apple = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const appleConfig = {
  fields: {
    issuerId: "57246542-96fe-1a63-e053-0824d011072a",
    keyId: "2X9R4HXF34",
    appId: "123456789",
    bundleId: "com.example.app",
    appPlatform: "IOS",
    version: "",
  },
  secret: apple.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
};
const google = generateKeyPairSync("rsa", { modulusLength: 2048 });
const googleConfig = {
  fields: { packageName: "com.example.app" },
  secret: JSON.stringify({
    client_email: "test@project.iam.gserviceaccount.com",
    private_key: google.privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
  }),
};
const response = (body: unknown, status = 200) =>
  Response.json(body, { status });
test("Apple 使用正确 ES256 签名，验证实际应用与 Bundle ID", async () => {
  const mock: typeof fetch = async (input, init) => {
    assert.match(String(input), /\/v1\/apps\/123456789/);
    const token = (init!.headers as Record<string, string>).Authorization.slice(
      7,
    );
    const [header, payload, signature] = token.split(".");
    assert.equal(
      JSON.parse(Buffer.from(header, "base64url").toString()).alg,
      "ES256",
    );
    assert.equal(
      JSON.parse(Buffer.from(payload, "base64url").toString()).aud,
      "appstoreconnect-v1",
    );
    assert.ok(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: apple.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    );
    return response({
      data: { id: "123456789", attributes: { bundleId: "com.example.app" } },
    });
  };
  assert.equal(
    (await checkConnection("apple", appleConfig, {}, mock)).status,
    "passed",
  );
  const mismatch: typeof fetch = async () =>
    response({
      data: { id: "123456789", attributes: { bundleId: "com.other.app" } },
    });
  assert.equal(
    (await checkConnection("apple", appleConfig, {}, mismatch)).status,
    "failed",
  );
});
test("Google 默认仅验证 OAuth，不创建 edit", async () => {
  let calls = 0;
  const mock: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), "https://oauth2.googleapis.com/token");
    const assertion = (init!.body as URLSearchParams).get("assertion")!;
    const [header, payload, signature] = assertion.split(".");
    assert.ok(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        google.publicKey,
        Buffer.from(signature, "base64url"),
      ),
    );
    return response({ access_token: "test-token" });
  };
  assert.equal(
    (await checkConnection("google", googleConfig, {}, mock)).status,
    "partial",
  );
  assert.equal(calls, 1);
});
test("Google 显式验证应用权限，读取失败仍删除 edit，不调用 commit", async () => {
  const calls: { url: string; method: string }[] = [];
  const mock: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/token")) return response({ access_token: "test-token" });
    if (url.endsWith("/edits")) return response({ id: "test-edit" });
    if (url.endsWith("/listings"))
      return response({ error: "sensitive-remote-content" }, 403);
    assert.equal(method, "DELETE");
    return response({});
  };
  const result = await checkConnection(
    "google",
    googleConfig,
    { verifyApplication: true },
    mock,
  );
  assert.equal(result.status, "failed");
  assert.match(result.message, /403/);
  assert.equal(calls.at(-1)?.method, "DELETE");
  assert.equal(
    calls.some((c) => c.url.includes("commit")),
    false,
  );
  assert.equal(
    JSON.stringify(result).includes("sensitive-remote-content"),
    false,
  );
});
test("Google 清理失败明确报告，不标记验证通过", async () => {
  const mock: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/token")) return response({ access_token: "test-token" });
    if (url.endsWith("/edits")) return response({ id: "test-edit" });
    if (init?.method === "DELETE") return response({}, 500);
    return response({ listings: [] });
  };
  const result = await checkConnection(
    "google",
    googleConfig,
    { verifyApplication: true },
    mock,
  );
  assert.equal(result.status, "failed");
  assert.match(result.message, /清理失败/);
});
test("AI 仅 GET 模型目录，不发送生成请求；未找到模型为部分通过", async () => {
  const config = {
    fields: {
      baseUrl: "https://example.com/v1/",
      model: "my-model",
      timeoutSeconds: 120,
      concurrency: 1,
    },
    secret: "test-key",
  };
  let calls = 0;
  const mock: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), "https://example.com/v1/models");
    assert.equal(init?.redirect, "error");
    return response({ data: [{ id: "my-model" }] });
  };
  assert.equal(
    (await checkConnection("image", config, {}, mock)).status,
    "passed",
  );
  assert.equal(calls, 1);
  const missing: typeof fetch = async () => response({ data: [] });
  assert.equal(
    (await checkConnection("text", config, {}, missing)).status,
    "partial",
  );
});
test("鉴权错误与超时有具体原因，不泄露响应中的密钥", async () => {
  const rejected: typeof fetch = async () =>
    response({ secret: "do-not-log-this" }, 401);
  const result = await checkConnection("apple", appleConfig, {}, rejected);
  assert.match(result.message, /401/);
  assert.equal(JSON.stringify(result).includes("do-not-log-this"), false);
  const timeout: typeof fetch = async () => {
    throw new DOMException("test", "TimeoutError");
  };
  assert.match(
    (await checkConnection("apple", appleConfig, {}, timeout)).message,
    /超时/,
  );
});
