import { CheckError, storeRequest } from "./store-request";
import { createGoogleEdit, deleteGoogleEdit } from "./google-edit";
import { appleToken, signJwt } from "./store-token";
import { orderedModels, configFields, type ConfigScope } from "./config-model";
export { CheckError, storeRequest } from "./store-request";
export type CheckResult = {
  status: "passed" | "partial" | "failed";
  message: string;
  checkedAt: string;
  steps: { step: string; message: string }[];
};
export async function checkConnection(
  scope: ConfigScope,
  config: { fields: unknown; secret: string },
  options: { verifyApplication?: boolean } = {},
  fetcher: typeof fetch = fetch,
  onStep: (step: string, message: string) => Promise<void> = async () => {},
): Promise<CheckResult> {
  const steps: CheckResult["steps"] = [];
  async function step(name: string, message: string) {
    steps.push({ step: name, message });
    await onStep(name, message);
  }
  const request = storeRequest.bind(null, fetcher);
  try {
    if (scope === "apple") {
      const fields = configFields.apple.parse(config.fields);
      const token = appleToken(config);
      await step("apple_app", "检查 Apple 鉴权与应用读取权限");
      const result = await request(
        `https://api.appstoreconnect.apple.com/v1/apps/${encodeURIComponent(fields.appId)}?fields[apps]=bundleId`,
        { headers: { Authorization: `Bearer ${token}` } },
        "apple_app",
      );
      const data = result.data as
        { id?: string; attributes?: { bundleId?: string } } | undefined;
      if (
        data?.id !== fields.appId ||
        data.attributes?.bundleId !== fields.bundleId
      )
        throw new CheckError(
          "apple_app",
          "返回的应用 ID 或 Bundle ID 与配置不一致，请核对配置。",
        );
      await step("apple_app", "Apple 鉴权成功，应用 ID 与 Bundle ID 匹配");
      return {
        status: "passed",
        message:
          "Apple 应用读取验证通过；未验证截图上传、写入权限或目标版本的可编辑状态。",
        checkedAt: new Date().toISOString(),
        steps,
      };
    }
    if (scope === "google") {
      const fields = configFields.google.parse(config.fields);
      await step("google_auth", "检查 Google 服务账号 OAuth 鉴权");
      const token = await googleAccessToken(config.secret, fetcher);
      await step("google_auth", "服务账号鉴权成功");
      if (!options.verifyApplication)
        return {
          status: "partial",
          message:
            "服务账号鉴权通过；尚未检查包名与 Play Console 应用权限。可使用“验证应用权限”继续。",
          checkedAt: new Date().toISOString(),
          steps,
        };
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      await step("google_edit", "创建临时 edit，以检查应用访问权限");
      const { id, url: editUrl } = await createGoogleEdit(
        fields.packageName,
        headers,
        request,
      );
      let readError: unknown;
      try {
        await request(`${editUrl}/listings`, { headers }, "google_listings");
        await step("google_listings", "包名有效，已读取应用本地化列表");
      } catch (e) {
        readError = e;
      }
      try {
        await deleteGoogleEdit(editUrl, headers, request);
        await step("google_cleanup", "已删除本次临时 edit，未提交任何更改");
      } catch {
        throw new CheckError(
          "google_cleanup",
          `临时 edit ${id} 清理失败，请在 Play Console 检查；验证未提交任何更改。`,
        );
      }
      if (readError) throw readError;
      return {
        status: "passed",
        message:
          "Google 服务账号、包名及商店资料读取权限验证通过；临时 edit 已清理。未验证最终提交或截图写入。",
        checkedAt: new Date().toISOString(),
        steps,
      };
    }
    const fields = configFields[scope].parse(config.fields);
    await step("model_catalog", "检查模型 API 鉴权与模型目录");
    const response = await request(
      `${fields.baseUrl.replace(/\/+$/, "")}/models`,
      { headers: { Authorization: `Bearer ${config.secret}` } },
      "model_catalog",
      Math.min(fields.timeoutSeconds * 1000, 60000),
    );
    if (!Array.isArray(response.data))
      throw new CheckError(
        "model_catalog",
        "服务未返回 OpenAI 兼容的模型目录（data 数组）。此验证不支持该目录格式，不能据此断定生成接口不可用。",
      );
    const catalog = new Set(
      response.data.map((item: { id?: unknown } | null) => item?.id),
    );
    const missing: string[] = [];
    for (const [index, id] of orderedModels(fields).entries()) {
      const found = catalog.has(id);
      await step(
        "model_" + (index + 1),
        index +
          1 +
          ". " +
          id +
          " · " +
          (found ? "已在目录中找到" : "目录中未找到"),
      );
      if (!found) missing.push(id);
    }
    if (missing.length)
      return {
        status: "partial",
        message:
          "模型目录中未找到：" +
          missing.join("、") +
          "。部分代理目录可能不完整。",
        checkedAt: new Date().toISOString(),
        steps,
      };
    await step("model_catalog", "携带密钥访问目录成功，配置的模型出现在目录中");
    return {
      status: "passed",
      message:
        "模型目录连接验证通过；未发送文本或图片生成请求，未验证生成能力或额度。",
      checkedAt: new Date().toISOString(),
      steps,
    };
  } catch (error) {
    const known =
      error instanceof CheckError
        ? error
        : new CheckError(
            "configuration",
            "配置无法读取或密钥无法使用，请检查运行环境主密钥和凭据格式。",
          );
    await step(known.step, known.message);
    return {
      status: "failed",
      message: known.message,
      checkedAt: new Date().toISOString(),
      steps,
    };
  }
}

export async function googleAccessToken(secret: string, fetcher: typeof fetch) {
  const request = storeRequest.bind(null, fetcher);
  const account = JSON.parse(secret);
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: now - 5,
      exp: now + 600,
    },
    account.private_key,
    "RS256",
  );

  const auth = await request(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    },
    "google_auth",
  );
  if (typeof auth.access_token !== "string" || !auth.access_token)
    throw new CheckError("google_auth", "OAuth 未返回有效访问令牌");
  return auth.access_token;
}
