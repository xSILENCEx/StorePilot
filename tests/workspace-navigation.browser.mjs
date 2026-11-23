import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import next from "next";
import { chromium } from "playwright-core";

test(
  "前往设置时等待草稿保存，冲突时保留当前编辑",
  { timeout: 45000 },
  async (t) => {
    const app = next({ dev: false, hostname: "127.0.0.1" });
    await app.prepare();
    const server = createServer(app.getRequestHandler());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await app.close();
    });
    const origin = "http://127.0.0.1:" + server.address().port;
    const browser = await chromium.launch({ channel: "msedge" });
    t.after(() => browser.close());
    const page = await browser.newPage();
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
    const title = page.getByPlaceholder("输入应用名称");
    const settings = page.locator('a[href="/settings"]');
    await title.fill("已修改");
    await settings.click();
    await pending.promise;
    assert.equal(new URL(page.url()).pathname, "/");
    release.resolve();
    await page.waitForURL("**/settings");
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
