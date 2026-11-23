import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { encryptSecret, decryptSecret } from "../lib/secrets";
import { configFields } from "../lib/config-model";
import { checkSecret } from "../lib/config-store";
test("凭据加密绑定应用/平台，随机 IV，篡改与换密钥均不能解密", () => {
  process.env.STOREPILOT_MASTER_KEY = randomBytes(32).toString("base64");
  const text = "test-private-credential";
  const a = encryptSecret(text, "apple:one");
  assert.equal(decryptSecret(a, "apple:one"), text);
  assert.ok(!a.includes(text));
  assert.notEqual(a, encryptSecret(text, "apple:one"));
  assert.throws(() => decryptSecret(a, "apple:two"));
  const parts = a.split(".");
  parts[2] = randomBytes(16).toString("base64");
  assert.throws(() => decryptSecret(parts.join("."), "apple:one"));
  process.env.STOREPILOT_MASTER_KEY = randomBytes(32).toString("base64");
  assert.throws(() => decryptSecret(a, "apple:one"));
});
test("AI 配置拒绝凭据 URL、远程明文 HTTP 与过大超时", () => {
  const fields = {
    baseUrl: "https://example.com/v1",
    model: "example",
    timeoutSeconds: 120,
  };
  assert.ok(configFields.text.safeParse(fields).success);
  for (const baseUrl of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com?key=secret",
  ])
    assert.equal(
      configFields.text.safeParse({ ...fields, baseUrl }).success,
      false,
    );
  assert.ok(
    configFields.image.safeParse({
      ...fields,
      baseUrl: "http://127.0.0.1:1234/v1",
    }).success,
  );
  assert.equal(
    configFields.text.safeParse({ ...fields, timeoutSeconds: 999 }).success,
    false,
  );
});
test("私钥与服务账号凭据先校验格式，不发出外部请求", () => {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  checkSecret(
    "apple",
    privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
  assert.throws(() => checkSecret("apple", "invalid"));
  assert.throws(() => checkSecret("google", "{}"));
  assert.throws(() => checkSecret("text", "line1\nline2"));
});

test("Apple 官方样例 Issuer ID 不受 UUID variant 限制", () => {
  assert.ok(
    configFields.apple.safeParse({
      issuerId: "57246542-96fe-1a63-e053-0824d011072a",
      keyId: "2X9R4HXF34",
      appId: "123456789",
      bundleId: "com.example.app",
      appPlatform: "IOS",
      version: "",
    }).success,
  );
});

test("模型列表不限于三个，兼容旧配置、去重并保留顺序", () => {
  const parsed = configFields.image.parse({
    baseUrl: "https://example.com",
    timeoutSeconds: 120,
    model: "a, b, a, c",
    fallbackModel: "d",
    secondFallbackModel: "e",
  });
  assert.equal(parsed.model, "a, b, c, d, e");
  assert.equal(
    configFields.text.safeParse({ ...parsed, model: ", ," }).success,
    false,
  );
  assert.equal(
    configFields.text.safeParse({ ...parsed, model: "a，b" }).success,
    false,
  );
});
