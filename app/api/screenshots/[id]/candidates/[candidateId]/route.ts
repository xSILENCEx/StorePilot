import { z } from "zod";
import {
  authorize,
  failure,
  HttpError,
  json,
} from "../../../../../../lib/http";
import { pool } from "../../../../../../lib/db";
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; candidateId: string }> },
) {
  try {
    await authorize(request);
    const { id, candidateId } = await context.params;
    z.uuid().parse(id);
    z.uuid().parse(candidateId);
    const result = await pool().query(
      "update image_candidates set discarded=true where id=$1 and group_id=$2 and status not in ('queued','running') and not exists(select 1 from screenshot_groups g where g.id=$2 and (g.adopted @> jsonb_build_array(jsonb_build_object('candidateId',$1::text)) or g.previous @> jsonb_build_array(jsonb_build_object('candidateId',$1::text))))",
      [candidateId, id],
    );
    if (!result.rowCount)
      throw new HttpError(409, "执行中、已采用或用于恢复的候选不能丢弃");
    return json({ discarded: true });
  } catch (e) {
    return failure(e);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; candidateId: string }> },
) {
  try {
    await authorize(request);
    const { id, candidateId } = await context.params;
    z.uuid().parse(id);
    z.uuid().parse(candidateId);
    const result = await pool().query(
      "update image_candidates set discarded=false where id=$1 and group_id=$2 and discarded",
      [candidateId, id],
    );
    if (!result.rowCount) throw new HttpError(404, "已隐藏候选不存在");
    return json({ discarded: false });
  } catch (e) {
    return failure(e);
  }
}
