import { createHash } from "node:crypto";
import { draftAssetUrls } from "../../../lib/screenshot-groups";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../../../lib/db";
import {
  workspaces,
  assets,
  storeSnapshots,
  googleSnapshots,
} from "../../../lib/schema";
import { authorize, failure, HttpError, json } from "../../../lib/http";
import { isPrimaryLocale } from "../../../lib/store-locales";
import { workspaceSchema } from "../../../lib/model";
export async function GET(request: Request) {
  try {
    await authorize(request);
    const known = new URL(request.url).searchParams.get("version");
    return db().transaction((tx) => {
      let state = tx
        .select({ revision: workspaces.revision })
        .from(workspaces)
        .where(eq(workspaces.id, "default"))
        .get();
      if (!state)
        state = tx
          .insert(workspaces)
          .values({ id: "default" })
          .returning({ revision: workspaces.revision })
          .get();
      const icons = new Map<string, { identifier: string; url: string }>();
      for (const [platform, table, identifierPath] of [
        ["apple", storeSnapshots, "$.target.bundleId"],
        ["google", googleSnapshots, "$.packageName"],
      ] as const) {
        const rows = tx
          .select({
            appId: table.app_id,
            identifier: sql<string>`json_extract(${table.current_snapshot}, ${identifierPath})`,
            url: sql<
              string | null
            >`json_extract(${table.current_snapshot}, '$.icon.url')`,
          })
          .from(table)
          .orderBy(table.app_id)
          .all();
        for (const icon of rows)
          if (icon.url)
            icons.set(platform + ":" + icon.appId, {
              identifier: icon.identifier,
              url: icon.url,
            });
      }
      const readVersion = createHash("sha256")
        .update(JSON.stringify([state.revision, ...icons]))
        .digest("hex");
      if (known === readVersion)
        return new Response(null, {
          status: 204,
          headers: { "Cache-Control": "private, no-store" },
        });
      const row = tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, "default"))
        .get()!;
      const payload = {
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
      };
      return json({ ...payload, readVersion });
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
    const row = db().transaction(
      (tx) => {
        const before = tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, "default"))
          .get();
        if (before?.revision !== value.revision) return;
        for (const app of value.apps) {
          const previous = before.apps.find((a) => a.id === app.id);
          if (!previous) continue;
          for (const platform of ["apple", "google"] as const) {
            if (!app[platform] || app[platform] !== previous[platform])
              continue;
            const prefix = platform + ":";
            const removed = Object.keys(previous.drafts).filter(
              (key) =>
                key.startsWith(prefix) && !Object.hasOwn(app.drafts, key),
            );
            if (!removed.length) continue;
            const table =
              platform === "apple" ? storeSnapshots : googleSnapshots;
            const snapshot = tx
              .select()
              .from(table)
              .where(eq(table.app_id, app.id))
              .get()?.current_snapshot;
            if (!snapshot) continue;
            const [identifier, primary] =
              "packageName" in snapshot
                ? [snapshot.packageName, snapshot.details?.defaultLanguage]
                : [snapshot.target.bundleId, snapshot.metadata.primaryLocale];
            if (
              identifier === app[platform] &&
              removed.some((key) =>
                isPrimaryLocale(key.slice(prefix.length), primary),
              )
            )
              throw new HttpError(409, "商店主语言 " + primary + " 不可删除");
          }
        }
        return tx
          .update(workspaces)
          .set({
            apps: value.apps,
            revision: value.revision + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(workspaces.id, "default"))
          .returning()
          .get();
      },
      { behavior: "immediate" },
    );
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
