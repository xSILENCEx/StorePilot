import { auth } from "./auth";
import { ZodError } from "zod";
export const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: privateHeaders });
}
export async function authorize(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin !== (process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000"))
      throw new HttpError(403, "请求来源不允许");
  }
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session) throw new HttpError(401, "请先登录");
  return session;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function failure(error: unknown) {
  if (error instanceof HttpError)
    return json({ error: error.message }, error.status);
  if (error instanceof SyntaxError)
    return json({ error: "请求 JSON 格式无效" }, 400);
  if (error instanceof ZodError)
    return json(
      {
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("；"),
      },
      400,
    );
  console.error(
    "StorePilot request failed:",
    error instanceof Error ? error.name : "unknown",
  );
  return json(
    { error: "服务暂不可用，请检查数据库、环境配置和服务端日志。" },
    503,
  );
}
