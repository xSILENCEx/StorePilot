import { z } from "zod";
import { configTarget as target } from "../../../../lib/config-target";
import { failure, HttpError, json } from "../../../../lib/http";
import { configInput } from "../../../../lib/config-model";
import { readConfig, saveConfig, configId } from "../../../../lib/config-store";
import { secretsReady } from "../../../../lib/secrets";
import { pool } from "../../../../lib/db";
export async function GET(
  request: Request,
  context: { params: Promise<{ scope: string }> },
) {
  try {
    const { scope, appId } = await target(request, context);
    return json({
      ...(await readConfig(scope, appId)),
      encryptionReady: secretsReady(),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(
  request: Request,
  context: { params: Promise<{ scope: string }> },
) {
  try {
    const { scope, appId } = await target(request, context);
    if (!secretsReady())
      throw new HttpError(
        503,
        "请先运行 npm run config:key 并重启 Web / Worker",
      );
    const body = await request.text();
    if (Buffer.byteLength(body) > 100000)
      throw new HttpError(413, "配置内容过大");
    const input = configInput.parse(JSON.parse(body));
    await saveConfig(scope, appId, input.revision, input.fields, input.secret);
    return json(await readConfig(scope, appId));
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ scope: string }> },
) {
  try {
    const { scope, appId } = await target(request, context);
    const revision = z
      .number()
      .int()
      .positive()
      .parse((await request.json()).revision);
    const result = await pool().query(
      "update connection_configs set secret='',fields='{}'::jsonb,verification=null,revision=revision+1,updated_at=now() where id=$1 and revision=$2",
      [configId(scope, appId), revision],
    );
    if (!result.rowCount) throw new HttpError(409, "配置已变更，请重新载入");
    return json({ deleted: true });
  } catch (e) {
    return failure(e);
  }
}
