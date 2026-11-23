import { sign } from "node:crypto";
import { configFields } from "./config-model";
export function signJwt(
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
export function appleToken(config: { fields: unknown; secret: string }) {
  const fields = configFields.apple.parse(config.fields);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
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
}
