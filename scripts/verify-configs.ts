import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { pool } from "../lib/db";
import { decryptSecret } from "../lib/secrets";
loadEnvConfig(process.cwd());
const base = "http://127.0.0.1:3000";
async function main() {
  const credentials = JSON.parse(
    await readFile("data/admin-login.json", "utf8"),
  );
  const login = await fetch(base + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const headers = { cookie, Origin: base, "Content-Type": "application/json" };
  const workspace = await (await fetch(base + "/api/apps", { headers })).json();
  const appId = crypto.randomUUID();
  const testApp = {
    id: appId,
    name: "Configuration integration test",
    apple: "com.storepilot.test",
    google: "com.storepilot.test",
    drafts: {},
  };
  assert.equal(
    (
      await fetch(base + "/api/apps", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          revision: workspace.revision,
          apps: [...workspace.apps, testApp],
        }),
      })
    ).status,
    200,
  );
  const appleKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  const googleKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  const cases = [
    {
      scope: "apple",
      fields: {
        issuerId: crypto.randomUUID(),
        keyId: "TESTKEY123",
        appId: "123456789",
        bundleId: testApp.apple,
        appPlatform: "IOS",
        version: "",
      },
      secret: appleKey,
    },
    {
      scope: "google",
      fields: { packageName: testApp.google },
      secret: JSON.stringify({
        type: "service_account",
        client_email: "test@test-project.iam.gserviceaccount.com",
        private_key: googleKey,
        token_uri: "https://oauth2.googleapis.com/token",
      }),
    },
    {
      scope: "text",
      fields: {
        baseUrl: "https://example.com/v1",
        model: "test-text",
        timeoutSeconds: 120,
        concurrency: 2,
      },
      secret: "test-text-api-key",
    },
    {
      scope: "image",
      fields: {
        baseUrl: "http://127.0.0.1:9999/v1",
        model: "test-image",
        timeoutSeconds: 300,
        concurrency: 1,
      },
      secret: "test-image-api-key",
    },
  ];
  for (const c of cases) {
    const scoped = c.scope === "apple" || c.scope === "google";
    const url =
      base + `/api/settings/${c.scope}${scoped ? "?appId=" + appId : ""}`;
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers });
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const initial = await response.json();
    if (initial.configured && !scoped) {
      console.log(`${c.scope} 已有配置，保留并跳过写入验证`);
      continue;
    }
    assert.ok(initial.encryptionReady, "Web 需要重新加载主密钥");
    let revision = initial.revision;
    const send = (body: unknown) =>
      fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
    assert.equal(
      (await send({ revision, fields: c.fields, secret: c.secret })).status,
      200,
    );
    let state = await (await fetch(url, { headers })).json();
    assert.equal(state.configured, true);
    assert.equal(state.verified, false);
    assert.equal(state.secret, undefined);
    assert.ok(!JSON.stringify(state).includes(c.secret));
    const id = `${c.scope}:${scoped ? appId : "global"}`;
    const {
      rows: [stored],
    } = await pool().query(
      "select secret from connection_configs where id=$1",
      [id],
    );
    assert.notEqual(stored.secret, c.secret);
    assert.equal(decryptSecret(stored.secret, id), c.secret);
    assert.equal(
      (await send({ revision, fields: c.fields, secret: c.secret })).status,
      409,
    );
    revision = state.revision;
    assert.equal(
      (await send({ revision, fields: c.fields, secret: "" })).status,
      200,
    );
    const {
      rows: [preserved],
    } = await pool().query(
      "select secret from connection_configs where id=$1",
      [id],
    );
    assert.equal(preserved.secret, stored.secret);
    state = await (await fetch(url, { headers })).json();
    assert.equal(
      (
        await fetch(url, {
          method: "DELETE",
          headers,
          body: JSON.stringify({ revision: state.revision }),
        })
      ).status,
      200,
    );
    const cleared = await (await fetch(url, { headers })).json();
    assert.equal(cleared.secretSaved, false);
    assert.ok(cleared.revision > state.revision);
    assert.equal(
      (
        await send({
          revision: state.revision,
          fields: c.fields,
          secret: c.secret,
        })
      ).status,
      409,
    );
  }
  const current = await (await fetch(base + "/api/apps", { headers })).json();
  assert.equal(
    (
      await fetch(base + "/api/apps", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          revision: current.revision,
          apps: current.apps.filter((a: { id: string }) => a.id !== appId),
        }),
      })
    ).status,
    200,
  );
  await pool().query("delete from connection_configs where app_id=$1", [appId]);
  console.log(
    "通过：四类配置保存、凭据加密及不回显、留空保留、修订冲突、清除及防旧版本覆盖、未登录拦截。未调用真实商店或模型服务。",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
