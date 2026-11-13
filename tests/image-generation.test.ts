import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callImageModel,
  replyBuffer,
  isPublicIPv4,
  ImageGenerationError,
} from "../lib/image-provider";
import {
  screenshotSettings,
  generationPrompt,
  validateGeneration,
  deviceFor,
} from "../lib/screenshot-model";
const config = {
  baseUrl: "https://images.example/v1",
  model: "configured-image-model",
  timeoutSeconds: 120,
  concurrency: 2,
};
test("原始 App 截图模板要求截图；整图可无素材；平台设备不可串用", () => {
  assert.ok(validateGeneration(screenshotSettings.parse({ mode: "template" })));
  assert.equal(
    validateGeneration(
      screenshotSettings.parse({ mode: "image-ai", prompt: "test" }),
    ),
    null,
  );
  assert.throws(() => deviceFor("google-phone", "apple"));
});
test("Images API 请求使用已配置模型，一次一张，不发送 GPT 不支持的 response_format", async () => {
  const settings = screenshotSettings.parse({
    mode: "image-ai",
    prompt: "test",
    quality: "high",
  });
  let calls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), "https://images.example/v1/images/generations");
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, config.model);
    assert.equal(body.n, 1);
    assert.equal(body.quality, "high");
    assert.equal(body.response_format, undefined);
    assert.equal(
      (init?.headers as Record<string, string>)["Idempotency-Key"],
      "candidate-test",
    );
    return Response.json({ data: [{ b64_json: "YWJj" }] });
  };
  const result = await callImageModel(
    config,
    "fixture-key",
    settings,
    "zh-Hans",
    "candidate-test",
    [],
    fetcher,
  );
  assert.equal((await replyBuffer(result)).toString(), "abc");
  assert.equal(calls, 1);
});
test("参考图按 multipart 发给 edits；自动质量省略而非强塞参数", async () => {
  const settings = screenshotSettings.parse({
    mode: "image-ai",
    prompt: "test",
  });
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://images.example/v1/images/edits");
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("quality"), null);
    assert.ok(init.body.get("image") instanceof Blob);
    assert.equal(
      (init.headers as Record<string, string>)["Content-Type"],
      undefined,
    );
    return Response.json({ data: [{ url: "https://cdn.example/image.png" }] });
  };
  assert.ok(
    (
      await callImageModel(
        config,
        "fixture-key",
        settings,
        "en-US",
        "candidate-test",
        [{ buffer: Buffer.from("image"), mime: "image/png" }],
        fetcher,
      )
    ).url,
  );
});
test("背景提示词不包含模板文案，模型不负责绘制真实 UI", () => {
  const prompt = generationPrompt(
    screenshotSettings.parse({
      mode: "template-ai",
      headline: "Private app headline",
      prompt: "soft green",
    }),
    "en-US",
  );
  assert.ok(!prompt.includes("Private app headline"));
  assert.match(prompt, /No text/);
  assert.match(prompt, /no UI/);
});
test("请求超时/网络结果未知不自动重试；错误不输出远端正文或密钥", async () => {
  let calls = 0;
  const timeout: typeof fetch = async () => {
    calls++;
    throw new Error("fixture-key");
  };
  await assert.rejects(
    () =>
      callImageModel(
        config,
        "fixture-key",
        screenshotSettings.parse({}),
        "en-US",
        "id",
        [],
        timeout,
      ),
    (e: unknown) =>
      e instanceof ImageGenerationError &&
      e.uncertain &&
      !e.message.includes("fixture-key"),
  );
  assert.equal(calls, 1);
  const rejected: typeof fetch = async () =>
    Response.json({ error: "fixture-key" }, { status: 401 });
  await assert.rejects(
    () =>
      callImageModel(
        config,
        "fixture-key",
        screenshotSettings.parse({}),
        "en-US",
        "id",
        [],
        rejected,
      ),
    /401/,
  );
});
test("生成结果不下载内网地址、不接受非法 Base64", async () => {
  for (const value of [
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
  ])
    assert.equal(isPublicIPv4(value), false);
  assert.ok(isPublicIPv4("8.8.8.8"));
  await assert.rejects(() => replyBuffer({ b64_json: "!!!!" }), /Base64/);
});
