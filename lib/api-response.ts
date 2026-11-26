// StorePilot API endpoints return a JSON error envelope on failure.
export async function readApiResponse(
  response: Response,
  fallback = "请求失败",
) {
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || fallback);
  return data;
}
