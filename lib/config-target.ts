import { findWorkspaceApp } from "./workspace-store";
import { z } from "zod";
import { authorize, HttpError } from "./http";
import { configScope } from "./config-model";
export async function configTarget(
  request: Request,
  context: { params: Promise<{ scope: string }> },
) {
  await authorize(request);
  const scope = configScope.parse((await context.params).scope);
  const appId = new URL(request.url).searchParams.get("appId") ?? undefined;
  if (scope === "apple" || scope === "google") {
    if (!findWorkspaceApp(z.uuid().parse(appId)))
      throw new HttpError(404, "应用不存在");
  } else if (appId) throw new HttpError(400, "AI 配置是工作空间级配置");
  return { scope, appId };
}
