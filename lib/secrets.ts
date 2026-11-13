import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function masterKey() {
  const value = process.env.STOREPILOT_MASTER_KEY ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new Error(
      "STOREPILOT_MASTER_KEY 必须为 32 字节随机密钥的 Base64 编码",
    );
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("Invalid master key");
  return key;
}
export function secretsReady() {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}
export function encryptSecret(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    body.toString("base64"),
  ].join(".");
}
export function decryptSecret(value: string, context: string) {
  const [version, iv, tag, body, ...extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !body || extra.length)
    throw new Error("Invalid encrypted secret");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
