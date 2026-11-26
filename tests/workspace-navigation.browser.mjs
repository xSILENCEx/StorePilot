import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test, { before, after } from "node:test";
import next from "next";
import { chromium } from "playwright-core";

let server, app, browser, origin;
before(async () => {
  app = next({ dev: false, hostname: "127.0.0.1" });
  await app.prepare();
  server = createServer(app.getRequestHandler());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ channel: "msedge" });
});
after(async () => {
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await app?.close();
});
async function workspacePage(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  return page;
}
test(
  "前往设置时等待草稿保存，冲突时保留当前编辑",
  { timeout: 45000 },
  async (t) => {
    const page = await workspacePage(t);
    const fixture = {
      id: crypto.randomUUID(),
      name: "导航测试",
      apple: "test.app",
      google: "",
      drafts: {
        "apple:en-US": {
          title: "旧名称",
          subtitle: "",
          keywords: "",
          description: "",
          images: [],
        },
      },
    };
    let workspace = { revision: 1, readVersion: "first", apps: [fixture] };
    const pending = Promise.withResolvers();
    const release = Promise.withResolvers();
    let conflict = false;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      if (new URL(request.url()).pathname.startsWith("/api/settings/"))
        return route.fulfill({ json: { fields: {}, revision: 0 } });
      if (new URL(request.url()).pathname === "/api/jobs")
        return route.fulfill({ json: { jobs: [] } });
      if (new URL(request.url()).pathname !== "/api/apps")
        return route.fulfill({ json: {} });
      if (request.method() === "GET") return route.fulfill({ json: workspace });
      assert.equal(request.method(), "PUT");
      if (conflict)
        return route.fulfill({ status: 409, json: { error: "测试修订冲突" } });
      pending.resolve();
      await release.promise;
      workspace = {
        apps: request.postDataJSON().apps,
        revision: 2,
        readVersion: "second",
      };
      return route.fulfill({ json: { revision: 2 } });
    });
    await page.goto(origin);
    await page.getByText(fixture.name, { exact: true }).click();
    await page.setViewportSize({ width: 360, height: 780 });
    const nav = page.getByRole("navigation", { name: "工作区导航" });
    await nav.getByRole("button", { name: "任务记录" }).click();
    await page.getByRole("button", { name: "关闭任务记录" }).click();
    await page.getByRole("button", { name: "商店配置" }).click();
    const store = page.getByRole("dialog", {
      name: fixture.name + " · Apple App Store Connect",
    });
    await store.getByLabel("Issuer ID").waitFor();
    await page.keyboard.press("Escape");
    await store.waitFor({ state: "hidden" });
    const title = page.getByPlaceholder("输入应用名称");
    const settings = page.locator('a[href="/settings"]');
    await title.fill("已修改");
    await settings.click();
    await pending.promise;
    assert.equal(new URL(page.url()).pathname, "/");
    release.resolve();
    await page.waitForURL("**/settings");
    await page.getByRole("heading", { name: "模型配置" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "管理配置" }).count(),
      2,
    );
    assert.equal(workspace.apps[0].drafts["apple:en-US"].title, "已修改");
    await page.goto(origin);
    await page.getByText(fixture.name, { exact: true }).click();
    conflict = true;
    await title.fill("保留在编辑器");
    await settings.click();
    await page.getByText("测试修订冲突", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
    assert.equal(await title.inputValue(), "保留在编辑器");
  },
);

test(
  "草稿图形使用共享图片预览，关闭再打开时重置缩放",
  { timeout: 45000 },
  async (t) => {
    const page = await workspacePage(t);
    const url = "/api/assets/" + "a".repeat(64);
    const fixture = {
      id: crypto.randomUUID(),
      name: "图形测试",
      apple: "",
      google: "test.app",
      drafts: {
        "google:en-US": {
          title: "",
          subtitle: "",
          description: "",
          keywords: "",
          images: [],
          graphics: { icon: url },
        },
      },
    };
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === url)
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
        });
      return route.fulfill({
        json:
          path === "/api/apps"
            ? { apps: [fixture], revision: 1, readVersion: "one" }
            : {},
      });
    });
    await page.goto(origin);
    await page.getByText(fixture.name, { exact: true }).click();
    const open = page.getByRole("button", { name: "预览应用图标" });
    await open.click();
    const dialog = page.getByRole("dialog", { name: "应用图标预览" });
    const img = dialog.getByRole("img", { name: "应用图标" });
    await img.waitFor();
    await img
      .locator("..")
      .dispatchEvent("wheel", { deltaY: -100, clientX: 100, clientY: 100 });
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector('[role="dialog"] img')
            .style.transform.match(/scale\(([^)]+)/)[1],
        ) > 1,
    );
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await open.click();
    await img.waitFor();
    assert.match(await img.getAttribute("style"), /scale\(1\)/);
  },
);

test("顶栏电源按钮取消后保留会话，确认后退出", async (t) => {
  const page = await workspacePage(t);
  let calls = 0;
  await page.route("**/api/apps", (route) =>
    route.fulfill({ json: { apps: [], revision: 1, readVersion: "initial" } }),
  );
  await page.route("**/api/auth/sign-out", (route) => {
    calls++;
    return route.fulfill({ json: {} });
  });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(origin);
  const power = page
    .getByRole("navigation")
    .getByRole("button", { name: "退出登录" });
  const dialog = page.getByRole("dialog", { name: "退出登录" });
  await power.click();
  await dialog.getByRole("button", { name: "取消" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(calls, 0);
  await power.click();
  await dialog.getByRole("button", { name: "确认退出" }).click();
  await page.waitForURL("**/login");
  assert.equal(calls, 1);
});
