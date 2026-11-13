import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
async function main() {
  const base = "http://127.0.0.1:3000";
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
  const state = await (
    await fetch(base + "/api/settings/text", { headers })
  ).json();
  const url = base + "/api/settings/text/verify";
  const revision = (state.revision ?? 0) + 1;
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ revision }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: { ...headers, Origin: "https://invalid.example" },
        body: JSON.stringify({ revision }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ revision: 0 }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ revision, verifyApplication: true }),
      })
    ).status,
    400,
  );
  const stale = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ revision }),
  });
  assert.equal(stale.status, state.configured ? 409 : 400);
  console.log(
    "通过：验证接口鉴权、来源检查、输入校验与旧修订拦截；未入队任务，未修改配置，未发出外部请求。",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
