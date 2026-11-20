import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../lib/db";
import { jobs, jobLogs, workspaces } from "../../../lib/schema";
import { enqueue } from "../../../lib/job-store";
import { authorize, failure, HttpError, json } from "../../../lib/http";
export async function GET(request: Request) {
  try {
    await authorize(request);
    const rows = db()
      .select()
      .from(jobs)
      .orderBy(desc(jobs.created_at))
      .limit(30)
      .all();
    const logs = rows.length
      ? db()
          .select()
          .from(jobLogs)
          .where(
            inArray(
              jobLogs.job_id,
              rows.map((j) => j.id),
            ),
          )
          .orderBy(jobLogs.id)
          .all()
      : [];
    return json({
      jobs: rows.map(({ input, ...j }) => ({
        ...j,
        ...(j.kind === "translate"
          ? { languages: String(input.source) + " → " + String(input.target) }
          : {}),
        logs: logs.filter((l) => l.job_id === j.id),
      })),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    await authorize(request);
    const input = z
      .union([
        z.object({ appId: z.uuid(), platform: z.enum(["apple", "google"]) }),
        z.object({ retryId: z.uuid() }),
      ])
      .parse(await request.json());
    const id = db().transaction(
      (tx) => {
        let app;
        let platform;
        if ("retryId" in input) {
          const previous = tx
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.id, input.retryId),
                eq(jobs.status, "failed"),
                eq(jobs.kind, "validate_draft"),
              ),
            )
            .get();
          if (!previous) throw new HttpError(409, "仅可重试已结束的校验任务");
          app = previous.input;
          platform = previous.platform;
        } else {
          app = tx
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, "default"))
            .get()
            ?.apps.find((a) => a.id === input.appId);
          if (!app || !app[input.platform])
            throw new HttpError(404, "应用或平台不存在");
          platform = input.platform;
        }
        return enqueue(
          {
            app_id: String(app.id),
            platform,
            kind: "validate_draft",
            input: app,
          },
          tx,
        );
      },
      { behavior: "immediate" },
    );
    return json({ id }, 202);
  } catch (e) {
    return failure(e);
  }
}
