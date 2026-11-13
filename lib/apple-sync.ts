import { z } from "zod";
import { sign } from "node:crypto";
import { configFields } from "./config-model";
import { draftSchema } from "./model";
import type { AppleSnapshot } from "./apple-sync-model";
export class AppleReadError extends Error {}
const resource = z.object({
  id: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()),
});
type Resource = z.infer<typeof resource>;
const base = "https://api.appstoreconnect.apple.com";
export async function readAppleSnapshot(
  config: { fields: unknown; secret: string },
  appInfoId = "",
  fetcher: typeof fetch = fetch,
): Promise<AppleSnapshot> {
  const fields = configFields.apple.parse(config.fields);
  if (!fields.version)
    throw new AppleReadError("请先在连接设置填写明确的目标版本号，再拉取。");
  const now = Math.floor(Date.now() / 1000);
  const data = [
    { alg: "ES256", kid: fields.keyId, typ: "JWT" },
    {
      iss: fields.issuerId,
      iat: now - 5,
      exp: now + 600,
      aud: "appstoreconnect-v1",
    },
  ]
    .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
    .join(".");
  const token = `${data}.${sign("sha256", Buffer.from(data), { key: config.secret, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  async function request(
    path: string,
  ): Promise<{ data: unknown; links?: { next?: string | null } }> {
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
          links: z
            .object({ next: z.string().nullable().optional() })
            .optional(),
        })
        .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      throw new AppleReadError("Apple 响应格式无效，未更新快照。");
    }
  }
  async function list(path: string) {
    const rows: Resource[] = [];
    const seen = new Set<string>();
    let next: string | null | undefined = path;
    while (next) {
      if (seen.has(next) || seen.size >= 30)
        throw new AppleReadError("Apple 分页异常，未更新快照。");
      seen.add(next);
      const page = await request(next);
      rows.push(...z.array(resource).parse(page.data));
      next = page.links?.next;
    }
    return rows;
  }
  const app = resource.parse(
    (await request(`/v1/apps/${encodeURIComponent(fields.appId)}`)).data,
  );
  if (app.id !== fields.appId || app.attributes.bundleId !== fields.bundleId)
    throw new AppleReadError("Apple 应用 ID / Bundle ID 与连接设置不匹配。");
  const versions = (
    await list(
      `/v1/apps/${fields.appId}/appStoreVersions?filter[platform]=${fields.appPlatform}&filter[versionString]=${encodeURIComponent(fields.version)}&limit=200`,
    )
  ).filter(
    (v) =>
      v.attributes.platform === fields.appPlatform &&
      v.attributes.versionString === fields.version,
  );
  if (versions.length !== 1)
    throw new AppleReadError(
      "目标版本不存在或不唯一，请在连接设置明确平台和版本。",
    );
  const infos = await list(`/v1/apps/${fields.appId}/appInfos?limit=200`);
  const choices = appInfoId ? infos.filter((v) => v.id === appInfoId) : infos;
  if (choices.length !== 1)
    throw new AppleReadError(
      `请选择应用资料 ID 后重新拉取：${infos.map((v) => `${v.id}（${v.attributes.state ?? v.attributes.appStoreState ?? "未知状态"}）`).join("；")}`,
    );
  const info = choices[0],
    version = versions[0];
  const infoLocales = await list(
    `/v1/appInfos/${encodeURIComponent(info.id)}/appInfoLocalizations?limit=200`,
  );
  const versionLocales = await list(
    `/v1/appStoreVersions/${encodeURIComponent(version.id)}/appStoreVersionLocalizations?limit=200`,
  );
  const locales: AppleSnapshot["locales"] = {};
  for (const [rows, level] of [
    [infoLocales, "info"],
    [versionLocales, "version"],
  ] as const) {
    const seen = new Set<string>();
    for (const row of rows) {
      const locale = z
        .string()
        .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
        .parse(row.attributes.locale);
      if (seen.has(locale))
        throw new AppleReadError("Apple 返回重复语言，未更新快照。");
      seen.add(locale);
      const entry = (locales[locale] ??= {
        draft: {
          title: "",
          subtitle: "",
          description: "",
          keywords: "",
          images: [],
        },
        appInfoLocalizationId: null,
        versionLocalizationId: null,
      });
      const text = (key: string) =>
        z.string().nullable().optional().parse(row.attributes[key]) ?? "";
      if (level === "info") {
        entry.draft.title = text("name");
        entry.draft.subtitle = text("subtitle");
        entry.appInfoLocalizationId = row.id;
      } else {
        entry.draft.description = text("description");
        entry.draft.keywords = text("keywords");
        entry.versionLocalizationId = row.id;
      }
      draftSchema.parse(entry.draft);
    }
  }
  return {
    target: {
      appId: fields.appId,
      bundleId: fields.bundleId,
      platform: fields.appPlatform,
      version: fields.version,
      versionId: version.id,
      versionState: String(
        version.attributes.appVersionState ??
          version.attributes.appStoreState ??
          "",
      ),
      appInfoId: info.id,
      appInfoState: String(
        info.attributes.state ?? info.attributes.appStoreState ?? "",
      ),
    },
    locales,
    fetchedAt: new Date().toISOString(),
  };
}
