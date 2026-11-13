import { eq, and } from "drizzle-orm";
import { db, pool } from "../../../lib/db";
import { workspaces } from "../../../lib/schema";
import { authorize, failure, HttpError, json } from "../../../lib/http";
import { workspaceSchema } from "../../../lib/model";
export async function GET(request: Request) {
  try {
    await authorize(request);
    await db()
      .insert(workspaces)
      .values({ id: "default" })
      .onConflictDoNothing();
    const [row] = await db()
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, "default"));
    return json({ apps: row.apps, revision: row.revision });
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
            d.images.map((url) => url.split("/").at(-1)),
          ),
        ),
      ),
    ];
    if (ids.length) {
      const found = await pool().query(
        "select id from assets where id = any($1)",
        [ids],
      );
      if (found.rowCount !== ids.length)
        throw new HttpError(400, "草稿包含不存在的素材");
    }
    const [row] = await db()
      .update(workspaces)
      .set({
        apps: value.apps,
        revision: value.revision + 1,
        updatedAt: new Date(),
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
