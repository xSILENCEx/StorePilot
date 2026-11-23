import { z } from "zod";
export class AppleReadError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
export const resource = z.object({
  id: z.string().min(1),
  type: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  relationships: z.record(z.string(), z.unknown()).optional(),
});
export type Resource = z.infer<typeof resource>;
const base = "https://api.appstoreconnect.apple.com";
export function appleReader(token: string, fetcher: typeof fetch) {
  async function request(path: string): Promise<{
    data: unknown;
    included?: Resource[];
    links?: { next?: string | null };
  }> {
    const url = new URL(path, base);
    if (
      url.origin !== base ||
      !url.pathname.startsWith("/v1/") ||
      url.username ||
      url.password
    )
      throw new AppleReadError("Apple 分页地址不可信，已停止读取。");
    let response;
    try {
      response = await fetcher(url.href, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new AppleReadError("Apple 读取超时或网络连接失败，请重试。");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppleReadError(
        `Apple 读取失败（HTTP ${response.status}），请检查凭据、权限和目标版本。`,
        response.status,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AppleReadError("Apple 响应为空。");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new AppleReadError("Apple 响应过大。");
      }
      chunks.push(part.value);
    }
    try {
      return z
        .object({
          data: z.unknown(),
          included: z.array(resource).optional(),
          links: z
            .object({ next: z.string().nullable().optional() })
            .optional(),
        })
        .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      throw new AppleReadError("Apple 响应格式无效，未更新快照。");
    }
  }
  const included = new Map<string, Resource>();
  async function list(path: string) {
    const rows: Resource[] = [];
    const seen = new Set<string>();
    let next: string | null | undefined = path;
    while (next) {
      if (seen.has(next) || seen.size >= 30)
        throw new AppleReadError("Apple 分页异常，未更新快照。");
      seen.add(next);
      const page = await request(next);
      for (const row of page.included ?? [])
        included.set(`${row.type}:${row.id}`, row);
      rows.push(...z.array(resource).parse(page.data));
      next = page.links?.next;
    }
    return rows;
  }
  return { request, list, included };
}
