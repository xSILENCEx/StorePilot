import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
const base = "http://127.0.0.1:3000";
async function main() {
  const credentials = JSON.parse(
    await readFile("data/admin-login.json", "utf8"),
  );
  assert.equal((await fetch(base + "/api/apps")).status, 401);
  const login = await fetch(base + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify(credentials),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const headers = { cookie, Origin: base, "Content-Type": "application/json" };
  const denied = await fetch(base + "/api/auth/sign-up/email", {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: "outsider@test.local",
      password: "test-password-123",
      name: "test",
    }),
  });
  assert.ok(denied.status >= 400);
  const original = await (await fetch(base + "/api/apps", { headers })).json();
  const id = crypto.randomUUID();
  const body = {
    revision: original.revision,
    apps: [
      ...original.apps,
      {
        id,
        name: "Integration check",
        apple: "com.storepilot.test",
        google: "",
        drafts: {
          "apple:en-US": {
            title: "Test",
            subtitle: "",
            description: "",
            keywords: "",
            images: [],
          },
        },
      },
    ],
  };
  assert.equal(
    (
      await fetch(base + "/api/apps", {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(base + "/api/apps", {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await fetch(base + "/api/apps", {
        method: "PUT",
        headers: { ...headers, Origin: "https://evil.example" },
        body: JSON.stringify(body),
      })
    ).status,
    403,
  );
  const image = await sharp({
    create: { width: 200, height: 400, channels: 3, background: "#167c66" },
  })
    .png()
    .toBuffer();
  async function upload() {
    const form = new FormData();
    form.set(
      "file",
      new Blob([new Uint8Array(image)], { type: "image/png" }),
      "test.png",
    );
    const r = await fetch(base + "/api/assets", {
      method: "POST",
      headers: { cookie, Origin: base },
      body: form,
    });
    assert.equal(r.status, 201);
    return r.json();
  }
  const asset = await upload();
  assert.equal((await upload()).id, asset.id);
  assert.equal((await fetch(base + asset.url)).status, 401);
  const downloaded = await fetch(base + asset.url, { headers });
  assert.equal(
    downloaded.headers.get("cache-control"),
    "private, no-store, max-age=0",
  );
  assert.equal(downloaded.status, 200);
  const r = await fetch(base + "/api/jobs", {
    method: "POST",
    headers,
    body: JSON.stringify({ appId: id, platform: "apple" }),
  });
  assert.equal(r.status, 202);
  const job = await r.json();
  let complete = false;
  for (let i = 0; i < 30; i++) {
    const tasks = await (await fetch(base + "/api/jobs", { headers })).json();
    const task = tasks.jobs.find((j: { id: string }) => j.id === job.id);
    if (task?.status === "succeeded") {
      assert.ok(task.logs.length >= 1);
      complete = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(complete, "Worker must finish persistent task");
  const current = await (await fetch(base + "/api/apps", { headers })).json();
  assert.equal(
    (
      await fetch(base + "/api/apps", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          revision: current.revision,
          apps: current.apps.filter((a: { id: string }) => a.id !== id),
        }),
      })
    ).status,
    200,
  );
  console.log(
    "通过：登录与关闭注册、未登录拦截、来源校验、数据库草稿、并发冲突、图片去重与鉴权、持久化 Worker 执行及日志。",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
