import { sign } from "node:crypto";
import { configFields, type ConfigScope } from "./config-model";
export type CheckResult = {
  status: "passed" | "partial" | "failed";
  message: string;
  checkedAt: string;
  steps: { step: string; message: string }[];
};
export class CheckError extends Error {
  constructor(
    public step: string,
    message: string,
  ) {
    super(message);
  }
}
function jwt(
  header: object,
  payload: object,
  key: string,
  algorithm: "ES256" | "RS256",
) {
  const data = [header, payload]
    .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
    .join(".");
  const signature = sign("sha256", Buffer.from(data), {
    key,
    ...(algorithm === "ES256" ? { dsaEncoding: "ieee-p1363" as const } : {}),
  }).toString("base64url");
  return `${data}.${signature}`;
}
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
      const now = Math.floor(Date.now() / 1000);
      const token = jwt(
        { alg: "ES256", kid: fields.keyId, typ: "JWT" },
        {
          iss: fields.issuerId,
          iat: now - 5,
          exp: now + 600,
          aud: "appstoreconnect-v1",
        },
        config.secret,
        "ES256",
      );
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
      const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(fields.packageName)}/edits`;
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      await step("google_edit", "创建临时 edit，以检查应用访问权限");
      const edit = await request(
        url,
        { method: "POST", headers, body: "{}" },
        "google_edit",
      );
      if (
        typeof edit.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(edit.id)
      )
        throw new CheckError(
          "google_edit",
          "创建 edit 的响应缺少 ID，请在 Play Console 检查未提交的 edit。",
        );
      const editUrl = `${url}/${encodeURIComponent(edit.id)}`;
      let readError: unknown;
      try {
        await request(`${editUrl}/listings`, { headers }, "google_listings");
        await step("google_listings", "包名有效，已读取应用本地化列表");
      } catch (e) {
        readError = e;
      }
      try {
        await request(editUrl, { method: "DELETE", headers }, "google_cleanup");
        await step("google_cleanup", "已删除本次临时 edit，未提交任何更改");
      } catch {
        throw new CheckError(
          "google_cleanup",
          `临时 edit ${edit.id} 清理失败，请在 Play Console 检查；验证未提交任何更改。`,
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
    if (
      !response.data.some(
        (item: unknown) =>
          !!item &&
          typeof item === "object" &&
          "id" in item &&
          item.id === fields.model,
      )
    )
      return {
        status: "partial",
        message:
          "模型目录可访问，但未找到配置的模型 ID；请核对名称。部分代理目录可能不完整，尚未验证生成调用。",
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

export async function storeRequest(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  stage: string,
  timeout = 30000,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    const error = e as { name?: string; cause?: { code?: string } };
    throw new CheckError(
      stage,
      error.name === "TimeoutError" || error.name === "AbortError"
        ? "连接超时，请检查本机网络和目标服务。"
        : `无法连接目标服务${error.cause?.code && /^[A-Z_]+$/.test(error.cause.code) ? `（${error.cause.code}）` : ""}，请检查打包机网络、DNS、代理或 TLS。`,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    const help: Record<number, string> = {
      400: "请求被拒绝：请检查凭据、服务账号或应用配置；Google 服务账号还需检查本机时间。",
      401: "鉴权失败：请检查密钥是否正确、过期或已撤销，以及本机时间。",
      403: "权限不足或 API 尚未启用，请检查对应服务的账号授权。",
      404: "应用、模型目录或 API 地址不存在，或当前账号不可见。",
      429: "触发限流或账户配额限制，请稍后重试。",
    };
    throw new CheckError(
      stage,
      `HTTP ${response.status}：${help[response.status] ?? "服务请求失败，请检查服务状态后重试。"}`,
    );
  }
  if (response.status === 204) return {};
  try {
    const reader = response.body?.getReader();
    if (!reader) return {};
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(chunk.value);
    }
    if (init.method === "DELETE" && !size) return {};
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    return data;
  } catch {
    throw new CheckError(
      stage,
      "服务响应格式不兼容或响应过大；请检查 API 地址和兼容协议。",
    );
  }
}

export async function googleAccessToken(secret: string, fetcher: typeof fetch) {
  const request = storeRequest.bind(null, fetcher);
  const account = JSON.parse(secret);
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt(
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
