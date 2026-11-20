import { draftAssetUrls } from "../../../lib/screenshot-groups";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../../../lib/db";
import {
  workspaces,
  assets,
  storeSnapshots,
  googleSnapshots,
} from "../../../lib/schema";
import { authorize, failure, HttpError, json } from "../../../lib/http";
import { workspaceSchema } from "../../../lib/model";
export async function GET(request: Request) {
  try {
    await authorize(request);
    const known = new URL(request.url).searchParams.get("revision");
    if (known !== null) {
      const current = db()
        .select({ revision: workspaces.revision })
        .from(workspaces)
        .where(eq(workspaces.id, "default"))
        .get();
      if (current && String(current.revision) === known)
        return new Response(null, {
          status: 204,
          headers: { "Cache-Control": "private, no-store" },
        });
    }
    await db()
      .insert(workspaces)
      .values({ id: "default" })
      .onConflictDoNothing();
    const [row] = await db()
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, "default"));
    const icons = new Map<string, { identifier: string; url: string }>();
    for (const [platform, table, identifierPath] of [
      ["apple", storeSnapshots, "$.target.bundleId"],
      ["google", googleSnapshots, "$.packageName"],
    ] as const) {
      const rows = db()
        .select({
          appId: table.app_id,
          identifier: sql<string>`json_extract(${table.current_snapshot}, ${identifierPath})`,
          url: sql<
            string | null
          >`json_extract(${table.current_snapshot}, '$.icon.url')`,
        })
        .from(table)
        .all();
      for (const icon of rows)
        if (icon.url)
          icons.set(platform + ":" + icon.appId, {
            identifier: icon.identifier,
            url: icon.url,
          });
    }
    return json({
      apps: row.apps.map((app) => {
        const platformIcons: Partial<Record<"apple" | "google", string>> = {};
        for (const platform of ["apple", "google"] as const) {
          const icon = icons.get(platform + ":" + app.id);
          if (icon && icon.identifier === app[platform])
            platformIcons[platform] = icon.url;
        }
        return { ...app, platformIcons };
      }),
      revision: row.revision,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(request: Request) {
  try {
    await authorize(request);
    if (Number(request.headers.get("content-length")) > 4 * 1024 * 1024)
      throw new HttpError(413, "草稿请求过大");
    const value = workspaceSchema.parse(await request.json());
    const ids = [
      ...new Set(
        value.apps.flatMap((a) =>
          Object.values(a.drafts).flatMap((d) =>
            draftAssetUrls(d).map((url) => url.split("/").at(-1)),
          ),
        ),
      ),
    ];
    if (ids.length) {
      const found = db()
        .select({ id: assets.id })
        .from(assets)
        .where(inArray(assets.id, ids as string[]))
        .all();
      if (found.length !== ids.length)
        throw new HttpError(400, "草稿包含不存在的素材");
    }
    const [row] = await db()
      .update(workspaces)
      .set({
        apps: value.apps,
        revision: value.revision + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(workspaces.id, "default"),
          eq(workspaces.revision, value.revision),
        ),
      )
      .returning();
    if (!row)
      throw new HttpError(
        409,
        "另一窗口已修改资料。请先导出当前草稿，再刷新页面合并。",
      );
    return json({ revision: row.revision });
  } catch (e) {
    return failure(e);
  }
}
