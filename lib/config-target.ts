import { z } from "zod";
import { authorize, HttpError } from "./http";
import { configScope } from "./config-model";
import { pool } from "./db";
export async function configTarget(
  request: Request,
  context: { params: Promise<{ scope: string }> },
) {
  await authorize(request);
  const scope = configScope.parse((await context.params).scope);
  const appId = new URL(request.url).searchParams.get("appId") ?? undefined;
  if (scope === "apple" || scope === "google") {
    z.uuid().parse(appId);
    const {
      rows: [row],
    } = await pool().query("select apps from workspaces where id='default'");
    if (!row?.apps.some((a: { id: string }) => a.id === appId))
      throw new HttpError(404, "应用不存在");
  } else if (appId) throw new HttpError(400, "AI 配置是工作空间级配置");
  return { scope, appId };
}
