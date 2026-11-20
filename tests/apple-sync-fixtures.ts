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
    screenshots?: boolean;
    legacy?: boolean;
    badImage?: boolean;
    sameState?: boolean;
    versions?: { id: string; attributes: Record<string, unknown> }[];
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
    let included: unknown[] | undefined;
    if (url.pathname === "/v1/apps/123")
      data = row("123", {
        bundleId: "test.app",
        name: "Fixture App",
        primaryLocale: "en-US",
        sku: "fixture-sku",
      });
    else if (url.pathname.endsWith("/build"))
      data = row("build1", {
        iconAssetToken: {
          width: 512,
          height: 512,
          templateUrl:
            "https://is1.mzstatic.com/image/thumb/icon/{w}x{h}bb.{f}",
        },
      });
    else if (url.pathname.endsWith("/appStoreVersions")) {
      assert.equal(url.searchParams.get("filter[platform]"), "IOS");
      data = options.versions ?? [
        row("v1", {
          platform: "IOS",
          versionString: "1.0",
          copyright: "2026 Fixture",
          appVersionState: "PREPARE_FOR_SUBMISSION",
        }),
      ];
    } else if (url.pathname.endsWith("/appInfos"))
      data = [
        row("info1", { state: "PREPARE_FOR_SUBMISSION" }),
        ...(options.ambiguous
          ? [
              row("info2", {
                state: options.sameState
                  ? "PREPARE_FOR_SUBMISSION"
                  : "READY_FOR_DISTRIBUTION",
              }),
            ]
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
          promotionalText: "A useful app",
          whatsNew: "New features",
          supportUrl: "https://example.com/support",
          marketingUrl: "https://example.com",
        }),
      ];
    else if (url.pathname.endsWith("/placements")) {
      if (options.legacy) return Response.json({ errors: [] }, { status: 404 });
      data = options.screenshots
        ? [
            {
              ...row("placement-1", {
                placementType: "APP_SCREENSHOT",
                placementGroup: "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE",
              }),
              relationships: {
                image: {
                  data: { type: "appAssetLibraryImages", id: "image-1" },
                },
              },
            },
            {
              ...row("placement-2", {
                placementType: "APP_SCREENSHOT",
                placementGroup: "IPAD_PRO_3GEN_129",
              }),
              relationships: {
                image: {
                  data: { type: "appAssetLibraryImages", id: "image-2" },
                },
              },
            },
          ]
        : [];
      included = ["image-1", "image-2"].map((id) => ({
        ...row(id, {
          referenceName: id,
          state: "PREPARE_FOR_SUBMISSION",
          imageAsset: {
            width: 80,
            height: 120,
            templateUrl: options.badImage
              ? "https://evil.example/{w}x{h}.{f}"
              : `https://is1.mzstatic.com/image/thumb/${id}/{w}x{h}bb.{f}`,
          },
        }),
        type: "appAssetLibraryImages",
      }));
    } else if (url.pathname.endsWith("/appScreenshotSets"))
      data =
        options.screenshots && options.legacy
          ? [row("set-1", { screenshotDisplayType: "APP_IPHONE_67" })]
          : [];
    else if (url.pathname.endsWith("/appScreenshots"))
      data = [
        row("legacy-image", {
          fileName: "screen.png",
          assetDeliveryState: { state: "COMPLETE" },
          imageAsset: {
            width: 80,
            height: 120,
            templateUrl:
              "https://is1.mzstatic.com/image/thumb/legacy/{w}x{h}bb.{f}",
          },
        }),
      ];
    else throw new Error("Unexpected path " + url.pathname);
    return Response.json({ data, included, links: { next } });
  };
}
