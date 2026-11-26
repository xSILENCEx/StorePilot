export const activeJobStatuses: ("queued" | "running")[] = [
  "queued",
  "running",
];
export function isJobActive(status: string | undefined | null) {
  return activeJobStatuses.some((active) => active === status);
}
