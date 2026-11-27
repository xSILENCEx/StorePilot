import { lookup } from "node:dns/promises";
import { get } from "node:https";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { assetPath } from "./storage";
import type { ImageSettings } from "./image-model";
export class ImageGenerationError extends Error {
  constructor(
    message: string,
    public uncertain = false,
  ) {
    super(message);
  }
}
export type ImageModelConfig = {
  model: string;
  baseUrl: string;
  timeoutSeconds: number;
};
export type ImageReply = {
  composition?: "scene";
  b64_json?: string;
  url?: string;
  sizing?: { model: string; target: string; requested: string };
};
export function responsePath(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid image request id");
  return path.join(
    path.dirname(assetPath("0".repeat(64))),
    "..",
    "image-responses",
    `${id}.json`,
  );
}
export async function checkpointReply(id: string, reply: ImageReply) {
  const file = responsePath(id);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(reply), { mode: 0o600 });
  await rename(temporary, file);
}
export async function savedReply(id: string): Promise<ImageReply | null> {
  try {
    return JSON.parse(await readFile(responsePath(id), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ImageGenerationError(
      "已保存的模型响应损坏，请检查素材备份；不会重新调用模型。",
    );
  }
}
export async function readLimited(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new ImageGenerationError("服务返回空响应");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new ImageGenerationError("服务响应超过大小限制");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function callImageModel(
  config: ImageModelConfig,
  secret: string,
  settings: ImageSettings,
  id: string,
  references: { buffer: Buffer; mime: string }[],
  fetcher: typeof fetch = fetch,
): Promise<ImageReply> {
  const fields: Record<string, string | number> = {
    model: config.model,
    prompt: settings.prompt,
    n: 1,
    size: settings.modelSize,
  };
  if (settings.quality !== "auto") fields.quality = settings.quality;
  let body: BodyInit;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    "Idempotency-Key": id,
  };
  if (references.length) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields))
      form.set(key, String(value));
    references.forEach((ref, i) =>
      form.append(
        references.length === 1 ? "image" : "image[]",
        new Blob([new Uint8Array(ref.buffer)], { type: ref.mime }),
        `reference-${i}.${ref.mime === "image/jpeg" ? "jpg" : "png"}`,
      ),
    );
    body = form;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(fields);
  }
  let response: Response;
  try {
    response = await fetcher(
      `${config.baseUrl.replace(/\/+$/, "")}/images/${references.length ? "edits" : "generations"}`,
      {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
      },
    );
  } catch {
    throw new ImageGenerationError(
      "模型请求中断或超时，远端是否计费未知。为防止重复计费，不会自动再次调用；可稍后明确选择生成新的图片。",
      true,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    const hints: Record<number, string> = {
      400: "请检查提示词、模型支持的尺寸/质量及参考图编辑能力",
      401: "API Key 无效或已撤销",
      402: "余额或额度不足",
      403: "模型权限不足或请求被服务拒绝",
      404: "模型或图像生成/编辑接口不存在",
      413: "参考图片过大",
      429: "限流或额度不足，请稍后重新生成",
    };
    throw new ImageGenerationError(
      `图像模型 HTTP ${response.status}：${hints[response.status] ?? "远端服务异常"}。`,
      response.status >= 500,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(
      (await readLimited(response, 48 * 1024 * 1024)).toString("utf8"),
    );
  } catch {
    throw new ImageGenerationError(
      "模型响应无法解析或过大，可能已计费；不会自动重新调用。",
      true,
    );
  }
  const first = (json as { data?: ImageReply[] })?.data?.[0];
  if (!first || (!first.b64_json && !first.url))
    throw new ImageGenerationError(
      "图像接口未返回 data[0].b64_json 或 url；请检查服务是否兼容 Images API。",
      true,
    );
  if (first.b64_json && typeof first.b64_json === "string")
    return { b64_json: first.b64_json };
  if (typeof first.url === "string") return { url: first.url };
  throw new ImageGenerationError("图像响应格式不兼容", true);
}
export function isPublicIPv4(ip: string) {
  const n = ip.split(".").map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
    return false;
  const [a, b] = n;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
export async function downloadImage(raw: string, depth = 0): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageGenerationError("生成图片下载地址无效");
  }
  if (url.protocol !== "https:" || url.username || url.password || depth > 3)
    throw new ImageGenerationError(
      "生成图片下载只允许 HTTPS 公网地址，最多 3 次跳转",
    );
  const addresses = await lookup(url.hostname, { all: true, family: 4 }).catch(
    () => {
      throw new ImageGenerationError(
        "生成图片地址无法解析，请检查网络；已保存模型响应，可重试处理而无需再次生成。",
      );
    },
  );
  if (!addresses.length || addresses.some((a) => !isPublicIPv4(a.address)))
    throw new ImageGenerationError("拒绝下载非公网地址的模型结果");
  return new Promise<Buffer>((resolve, reject) => {
    const request = get(
      url,
      {
        family: 4,
        lookup: (_host, _options, callback) =>
          callback(null, addresses[0].address, 4),
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          void downloadImage(
            new URL(response.headers.location!, url).href,
            depth + 1,
          ).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new ImageGenerationError(
              `生成图片下载失败（HTTP ${response.statusCode}），不会自动重新调用模型`,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 32 * 1024 * 1024) {
            response.destroy();
            reject(new ImageGenerationError("生成图片超过 32 MB 限制"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", () =>
          reject(new ImageGenerationError("生成图片下载中断，可重试处理")),
        );
      },
    );
    request.setTimeout(60000, () => {
      request.destroy();
      reject(new ImageGenerationError("生成图片下载超时，可重试处理"));
    });
    request.on("error", () =>
      reject(
        new ImageGenerationError("生成图片下载连接失败，请检查服务端网络"),
      ),
    );
  });
}
export async function replyBuffer(
  reply: ImageReply,
  downloader: typeof downloadImage = downloadImage,
) {
  if (reply.b64_json) {
    if (
      reply.b64_json.length > 46 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/\r\n]+=*$/.test(reply.b64_json)
    )
      throw new ImageGenerationError("生成图片的 Base64 数据无效或过大");
    return Buffer.from(reply.b64_json, "base64");
  }
  if (reply.url) return downloader(reply.url);
  throw new ImageGenerationError("未找到图片结果");
}
