import { getStoreSync, queueStoreSync } from "../../../lib/store-sync-route";
export function GET(request: Request) {
  return getStoreSync(request, "apple");
}
export function POST(request: Request) {
  return queueStoreSync(request, "apple");
}
