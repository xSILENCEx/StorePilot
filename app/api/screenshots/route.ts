import { authorize, failure, json } from "../../../lib/http";
import { groupTarget } from "../../../lib/screenshot-model";
import { createGroup } from "../../../lib/screenshot-store";
export async function POST(request: Request) {
  try {
    await authorize(request);
    return json(await createGroup(groupTarget.parse(await request.json())));
  } catch (e) {
    return failure(e);
  }
}
