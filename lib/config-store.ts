import { createPrivateKey } from "node:crypto";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { connectionConfigs } from "./schema";
import { configFields, type ConfigScope } from "./config-model";
import { encryptSecret, decryptSecret } from "./secrets";
import { HttpError } from "./http";
export function checkSecret(scope: ConfigScope, value: string) {
  if (!value.trim()) throw new HttpError(400, "首次保存必须填写凭据");
  if (scope === "apple") {
    try {
      const key = createPrivateKey(value);
      if (
        key.asymmetricKeyType !== "ec" ||
        key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
      )
        throw new Error();
    } catch {
      throw new HttpError(400, "Apple 私钥必须为有效的 P-256 .p8 私钥");
    }
  } else if (scope === "google") {
    try {
      const data = JSON.parse(value);
      if (
        data.type !== "service_account" ||
        typeof data.client_email !== "string" ||
        !data.client_email.endsWith(".gserviceaccount.com") ||
        typeof data.private_key !== "string" ||
        createPrivateKey(data.private_key).asymmetricKeyType !== "rsa"
      )
        throw new Error();
      if (
        data.token_uri &&
        ![
          "https://oauth2.googleapis.com/token",
          "https://accounts.google.com/o/oauth2/token",
        ].includes(data.token_uri)
      )
        throw new Error();
    } catch {
      throw new HttpError(
        400,
        "请上传有效的 Google 服务账号 JSON（包含 client_email 和 RSA private_key）",
      );
    }
  } else if (value.length > 8192 || /[\r\n]/.test(value)) {
    throw new HttpError(400, "API Key 应为单行文本，最多 8192 字符");
  }
}
export function configId(scope: ConfigScope, appId?: string) {
  return `${scope}:${appId ?? "global"}`;
}
export async function readConfig(scope: ConfigScope, appId?: string) {
  const row = db()
    .select()
    .from(connectionConfigs)
    .where(eq(connectionConfigs.id, configId(scope, appId)))
    .get();
  const verification =
    row?.verification?.revision === row?.revision ? row?.verification : null;
  return {
    fields:
      (scope === "text" || scope === "image") && row?.fields.model
        ? configFields[scope].parse(row.fields)
        : (row?.fields ?? {}),
    secretSaved: !!row?.secret,
    revision: row?.revision ?? 0,
    configured: !!row?.secret,
    verified: !!row?.secret && verification?.status === "passed",
    verification,
    updatedAt: row?.updated_at ?? null,
  };
}
export async function workerConfig(scope: ConfigScope, appId?: string) {
  const id = configId(scope, appId);
  const row = db()
    .select()
    .from(connectionConfigs)
    .where(eq(connectionConfigs.id, id))
    .get();
  if (!row?.secret) throw new Error("Configuration not found");
  return {
    revision: row.revision,
    fields: configFields[scope].parse(row.fields),
    secret: decryptSecret(row.secret, id),
  };
}
export async function saveConfig(
  scope: ConfigScope,
  appId: string | undefined,
  revision: number,
  fields: Record<string, unknown>,
  secret?: string,
) {
  const parsed = configFields[scope].parse(fields);
  const id = configId(scope, appId);
  db().transaction(
    (tx) => {
      const old = tx
        .select()
        .from(connectionConfigs)
        .where(eq(connectionConfigs.id, id))
        .get();
      if ((old?.revision ?? 0) !== revision)
        throw new HttpError(409, "配置已被其他窗口修改，请重新载入后编辑");
      let encrypted = old?.secret;
      if (secret) {
        checkSecret(scope, secret);
        encrypted = encryptSecret(secret, id);
      }
      if (!encrypted) throw new HttpError(400, "首次保存必须填写凭据");
      const value = {
        id,
        scope,
        app_id: appId ?? null,
        fields: parsed,
        secret: encrypted,
        revision: revision + 1,
        verification: null,
        updated_at: new Date().toISOString(),
      };
      tx.insert(connectionConfigs)
        .values(value)
        .onConflictDoUpdate({ target: connectionConfigs.id, set: value })
        .run();
    },
    { behavior: "immediate" },
  );
}
