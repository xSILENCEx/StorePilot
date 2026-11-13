import { z } from "zod";
import {
  authorize,
  failure,
  HttpError,
  json,
} from "../../../../../../../lib/http";
import { pool } from "../../../../../../../lib/db";
import { savedReply } from "../../../../../../../lib/image-provider";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; candidateId: string }> },
) {
  let client;
  try {
    await authorize(request);
    const { id, candidateId } = await context.params;
    z.uuid().parse(id);
    z.uuid().parse(candidateId);
    client = await pool().connect();
    await client.query("begin");
    const {
      rows: [candidate],
    } = await client.query(
      "select * from image_candidates where id=$1 and group_id=$2 and status in ('failed','uncertain') and not discarded for update",
      [candidateId, id],
    );
    if (!candidate?.job_id) throw new HttpError(409, "该候选不可重试处理");
    if (
      candidate.origin !== "template" &&
      !candidate.raw_url &&
      !(await savedReply(candidateId))
    )
      throw new HttpError(
        409,
        "没有已保存的模型结果，无法无费用重试；需要新图请生成新的候选",
      );
    await client.query(
      "update image_candidates set status='queued',error=null,updated_at=now() where id=$1",
      [candidateId],
    );
    await client.query(
      "update jobs set status='queued',result=null,updated_at=now() where id=$1",
      [candidate.job_id],
    );
    await client.query(
      "select graphile_worker.add_job('generate_image',$1::json,queue_name := 'image:0',job_key := $2,max_attempts := 3)",
      [JSON.stringify({ id: candidate.job_id }), `resume:${candidateId}`],
    );
    await client.query("commit");
    return json({ id: candidateId }, 202);
  } catch (e) {
    if (client) await client.query("rollback");
    return failure(e);
  } finally {
    client?.release();
  }
}
