import { getStoreSync, queueStoreSync } from "../../../lib/store-sync-route";
export function GET(request: Request) {
  return getStoreSync(request, "google");
}
export function POST(request: Request) {
  return queueStoreSync(request, "google");
}
