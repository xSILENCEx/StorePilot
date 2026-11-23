import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { getMigrations } from "better-auth/db/migration";
import { closeDb } from "../lib/db";
import { auth } from "../lib/auth";
import { saveConfig } from "../lib/config-store";
import { PUT as saveApps } from "../app/api/apps/route";

import type { TestContext } from "node:test";
export async function workflowFixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "storepilot-test-"));
  const originalFetch = globalThis.fetch;
  process.env.DATABASE_PATH = path.join(directory, "storepilot.sqlite");
  process.env.STORAGE_PATH = path.join(directory, "assets");
  process.env.STOREPILOT_MASTER_KEY = randomBytes(32).toString("base64");
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
  const origin = (process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000");
  t.after(async () => {
    globalThis.fetch = originalFetch;
    closeDb();
    await rm(directory, { recursive: true, force: true });
  });
  await (await getMigrations(auth().options)).runMigrations();
  await auth(true).api.signUpEmail({
    body: {
      email: "test@storepilot.local",
      password: "fixture-password-123",
      name: "Test",
    },
  });
  const login = await auth().api.signInEmail({
    body: {
      email: "test@storepilot.local",
      password: "fixture-password-123",
    },
    asResponse: true,
  });
  assert.equal(login.status, 200);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie);
  function request(url: string, method = "GET", body?: unknown, headers = {}) {
    return new Request(origin + url, {
      method,
      headers: {
        cookie,
        Origin: origin,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const appId = randomUUID();
  const draft = {
    title: "Test",
    subtitle: "",
    description: "",
    keywords: "",
    images: [] as string[],
  };
  const app = {
    id: appId,
    name: "Fixture",
    apple: "test.app",
    google: "test.app",
    drafts: { "apple:en-US": draft, "google:en-US": draft },
  };
  async function seedWorkspace() {
    assert.equal(
      (
        await saveApps(
          request("/api/apps", "PUT", { revision: 0, apps: [app] }),
        )
      ).status,
      200,
    );
  }
  async function configureImages() {
    await saveConfig(
      "image",
      undefined,
      0,
      {
        baseUrl: "https://images.example/v1",
        model: "fixture-model",
        timeoutSeconds: 30,
      },
      "fixture-key",
    );
  }
  return {
    origin,
    cookie,
    appId,
    app,
    draft,
    request,
    directory,
    seedWorkspace,
    configureImages,
  };
}
