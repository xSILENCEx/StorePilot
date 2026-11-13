import { z } from "zod";
import { authorize, failure, HttpError, json } from "../../../../lib/http";
import {
  getGroup,
  assertGroupApp,
  assertAssets,
} from "../../../../lib/screenshot-store";
import { screenshotSettings } from "../../../../lib/screenshot-model";
import { pool } from "../../../../lib/db";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await authorize(request);
    const { id } = await context.params;
    z.uuid().parse(id);
    return json(await getGroup(id));
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await authorize(request);
    const { id } = await context.params;
    z.uuid().parse(id);
    const input = z
      .object({
        revision: z.number().int().positive(),
        settings: screenshotSettings,
      })
      .strict()
      .parse(await request.json());
    const group = await getGroup(id);
    await assertGroupApp(group);
    await assertAssets([input.settings.screenshot, input.settings.art]);
    const { rowCount } = await pool().query(
      "update screenshot_groups set settings=$3,revision=revision+1,updated_at=now() where id=$1 and revision=$2",
      [id, input.revision, input.settings],
    );
    if (!rowCount)
      throw new HttpError(
        409,
        "截图组已被其他窗口修改，请先保存提示词备份再重新载入",
      );
    return json(await getGroup(id));
  } catch (e) {
    return failure(e);
  }
}
