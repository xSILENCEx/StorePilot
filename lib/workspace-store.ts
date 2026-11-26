import { eq } from "drizzle-orm";
import { db } from "./db";
import { workspaces } from "./schema";
type Reader = Pick<ReturnType<typeof db>, "select">;
export function readWorkspace(reader: Reader = db()) {
  return reader
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, "default"))
    .get();
}
export function findWorkspaceApp(appId: string, reader: Reader = db()) {
  return readWorkspace(reader)?.apps.find((app) => app.id === appId);
}
