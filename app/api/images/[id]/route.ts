import { activeJobStatuses } from "../../../../lib/job-status";
import { z } from "zod";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "../../../../lib/db";
import { jobs } from "../../../../lib/schema";
import { authorize, failure, HttpError, json } from "../../../../lib/http";
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await authorize(request);
    const id = z.uuid().parse((await context.params).id);
    const result = db()
      .delete(jobs)
      .where(
        and(
          eq(jobs.id, id),
          eq(jobs.kind, "generate_image"),
          notInArray(jobs.status, [...activeJobStatuses, "paused"]),
        ),
      )
      .run();
    if (!result.changes) throw new HttpError(409, "图片不存在或仍在生成");
    return json({ deleted: true });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await authorize(request);
    const id = z.uuid().parse((await context.params).id);
    const updated = db()
      .update(jobs)
      .set({
        status: "queued",
        result: {},
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(jobs.id, id),
          eq(jobs.kind, "generate_image"),
          eq(jobs.status, "failed"),
        ),
      )
      .run();
    if (!updated.changes) throw new HttpError(409, "仅可重试已失败的图片");
    return json({ id }, 202);
  } catch (e) {
    return failure(e);
  }
}
