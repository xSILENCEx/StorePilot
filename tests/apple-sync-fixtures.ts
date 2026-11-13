import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
export const config = {
  fields: {
    issuerId: "00000000-0000-0000-0000-000000000000",
    keyId: "ABCDEFGHIJ",
    appId: "123",
    bundleId: "test.app",
    appPlatform: "IOS",
    version: "1.0",
  },
  secret: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
export function mockApple(
  options: {
    ambiguous?: boolean;
    badNext?: boolean;
    fail?: boolean;
    title?: string;
  } = {},
): typeof fetch {
  return async (input, init) => {
    assert.equal(init?.method, "GET");
    assert.match(
      String((init?.headers as Record<string, string>).Authorization),
      /^Bearer /,
    );
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.appstoreconnect.apple.com");
    if (options.fail)
      return new Response("private remote error", { status: 403 });
    const row = (id: string, attributes: object) => ({ id, attributes });
    let data: unknown;
    let next: string | undefined;
    if (url.pathname === "/v1/apps/123")
      data = row("123", { bundleId: "test.app" });
    else if (url.pathname.endsWith("/appStoreVersions")) {
      assert.equal(url.searchParams.get("filter[versionString]"), "1.0");
      data = [
        row("v1", {
          platform: "IOS",
          versionString: "1.0",
          appVersionState: "PREPARE_FOR_SUBMISSION",
        }),
      ];
    } else if (url.pathname.endsWith("/appInfos"))
      data = [
        row("info1", { state: "PREPARE_FOR_SUBMISSION" }),
        ...(options.ambiguous
          ? [row("info2", { state: "READY_FOR_DISTRIBUTION" })]
          : []),
      ];
    else if (url.pathname.endsWith("/appInfoLocalizations")) {
      data = [
        row("il1", {
          locale: "en-US",
          name: options.title ?? "Remote",
          subtitle: null,
        }),
      ];
      next = options.badNext ? "https://evil.invalid/v1/steal" : "/v1/page2";
    } else if (url.pathname === "/v1/page2")
      data = [
        row("il2", { locale: "zh-Hans", name: "远端", subtitle: "副标题" }),
      ];
    else if (url.pathname.endsWith("/appStoreVersionLocalizations"))
      data = [
        row("vl1", {
          locale: "en-US",
          description: "Description",
          keywords: "key",
        }),
      ];
    else throw new Error("Unexpected path " + url.pathname);
    return Response.json({ data, links: { next } });
  };
}
