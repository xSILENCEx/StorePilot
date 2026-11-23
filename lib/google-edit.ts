import { CheckError, storeRequest } from "./store-request";
type RequestEdit = (
  url: string,
  init: RequestInit,
  stage: string,
) => ReturnType<typeof storeRequest>;
export async function createGoogleEdit(
  packageName: string,
  headers: HeadersInit,
  request: RequestEdit,
) {
  const base =
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
    encodeURIComponent(packageName) +
    "/edits";
  const { id } = await request(
    base,
    { method: "POST", headers, body: "{}" },
    "google_edit",
  );
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id))
    throw new CheckError(
      "google_edit",
      "创建 edit 的响应缺少 ID，请在 Play Console 检查未提交的 edit。",
    );
  return { id, url: base + "/" + id };
}
export async function deleteGoogleEdit(
  url: string,
  headers: HeadersInit,
  request: RequestEdit,
) {
  try {
    await request(url, { method: "DELETE", headers }, "google_cleanup");
  } catch (error) {
    if (!(
      error instanceof CheckError &&
      (error.status === 404 || error.status === 410)
    ))
      throw error;
  }
}
