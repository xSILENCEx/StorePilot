import { z } from "zod";
import { authorize, failure, HttpError, json } from "../../../../../lib/http";
import { getGroup, assertGroupApp } from "../../../../../lib/screenshot-store";
import {
  deviceFor,
  type AdoptedImage,
} from "../../../../../lib/screenshot-model";
import { pool } from "../../../../../lib/db";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let client;
  try {
    await authorize(request);
    const { id } = await context.params;
    z.uuid().parse(id);
    const input = z
      .object({
        revision: z.number().int().positive(),
        action: z.enum(["append", "replace", "reorder", "restore"]),
        candidateId: z.uuid().optional(),
        order: z.array(z.uuid()).max(10).optional(),
      })
      .strict()
      .parse(await request.json());
    const group = await getGroup(id);
    await assertGroupApp(group);
    const device = deviceFor(group.device, group.platform);
    client = await pool().connect();
    await client.query("begin");
    const {
      rows: [locked],
    } = await client.query(
      "select * from screenshot_groups where id=$1 for update",
      [id],
    );
    if (locked.revision !== input.revision)
      throw new HttpError(409, "截图组已修改，请重新载入再操作");
    let next: AdoptedImage[];
    if (input.action === "restore") {
      if (!locked.has_previous)
        throw new HttpError(400, "暂无可恢复的上次结果");
      next = locked.previous;
    } else if (input.action === "reorder") {
      if (!input.order || new Set(input.order).size !== input.order.length)
        throw new HttpError(400, "截图顺序无效");
      next = input.order.map((id) => {
        const item = locked.adopted.find(
          (a: AdoptedImage) => a.candidateId === id,
        );
        if (!item) throw new HttpError(400, "只能排序或移除已采用结果");
        return item;
      });
    } else {
      if (!input.candidateId) throw new HttpError(400, "请选择候选");
      const {
        rows: [candidate],
      } = await client.query(
        "select * from image_candidates where id=$1 and group_id=$2 and status='succeeded' and not discarded",
        [input.candidateId, id],
      );
      if (!candidate?.url)
        throw new HttpError(400, "只能采用当前截图组中已完成的候选");
      const item = {
        candidateId: candidate.id,
        url: candidate.url,
        thumbnail: candidate.thumbnail,
        width: device.width,
        height: device.height,
        origin: candidate.origin,
        format: candidate.settings.output,
      };
      next =
        input.action === "replace"
          ? [item]
          : [
              ...locked.adopted.filter(
                (a: AdoptedImage) => a.candidateId !== item.candidateId,
              ),
              item,
            ];
    }
    if (next.length > device.max)
      throw new HttpError(400, `此设备最多采用 ${device.max} 张截图`);
    await client.query(
      "update screenshot_groups set adopted=$2,previous=adopted,has_previous=true,revision=revision+1,updated_at=now() where id=$1",
      [id, JSON.stringify(next)],
    );
    await client.query("commit");
    return json(await getGroup(id));
  } catch (e) {
    if (client) await client.query("rollback");
    return failure(e);
  } finally {
    client?.release();
  }
}
