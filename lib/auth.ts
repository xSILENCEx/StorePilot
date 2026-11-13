import { betterAuth } from "better-auth";
import { sqlite } from "./db";
function createAuth(allowSignup = false) {
  if (
    !process.env.BETTER_AUTH_SECRET ||
    process.env.BETTER_AUTH_SECRET.length < 32
  )
    throw new Error("请配置至少 32 字符的 BETTER_AUTH_SECRET");
  return betterAuth({
    database: sqlite(),
    baseURL: process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000",
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowSignup,
      minPasswordLength: 12,
    },
    advanced: {
      useSecureCookies:
        process.env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
    },
    rateLimit: { enabled: true },
  });
}

const authCache = globalThis as unknown as {
  storepilotAuth?: ReturnType<typeof createAuth>;
  storepilotAuthDatabase?: ReturnType<typeof sqlite>;
};
export function auth(allowSignup = false) {
  if (allowSignup) return createAuth(true);
  const database = sqlite();
  if (
    !authCache.storepilotAuth ||
    authCache.storepilotAuthDatabase !== database
  ) {
    authCache.storepilotAuth = createAuth(false);
    authCache.storepilotAuthDatabase = database;
  }
  return authCache.storepilotAuth;
}
