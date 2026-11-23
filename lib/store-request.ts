export class CheckError extends Error {
  constructor(
    public step: string,
    message: string,
    public status?: number,
  ) {
    super(message);
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
        ? "连接超时，请检查服务端网络和目标服务。"
        : `无法连接目标服务${error.cause?.code && /^[A-Z_]+$/.test(error.cause.code) ? `（${error.cause.code}）` : ""}，请检查服务端网络、DNS、代理或 TLS。`,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    const help: Record<number, string> = {
      400: "请求被拒绝：请检查凭据、服务账号或应用配置；Google 服务账号还需检查服务器时间。",
      401: "鉴权失败：请检查密钥是否正确、过期或已撤销，以及服务器时间。",
      403: "权限不足或 API 尚未启用，请检查对应服务的账号授权。",
      404: "应用、模型目录或 API 地址不存在，或当前账号不可见。",
      429: "触发限流或账户配额限制，请稍后重试。",
    };
    throw new CheckError(
      stage,
      `HTTP ${response.status}：${help[response.status] ?? "服务请求失败，请检查服务状态后重试。"}`,
      response.status,
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
