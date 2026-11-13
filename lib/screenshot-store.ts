import { pool } from "./db";
import { HttpError } from "./http";
import {
  deviceFor,
  screenshotSettings,
  type ScreenshotGroup,
} from "./screenshot-model";
export async function getGroup(id: string): Promise<ScreenshotGroup> {
  const {
    rows: [group],
  } = await pool().query("select * from screenshot_groups where id=$1", [id]);
  if (!group) throw new HttpError(404, "截图组不存在");
  const { rows } = await pool().query(
    "select id,job_id,status,url,thumbnail,error,settings,origin,created_at,discarded,(raw_url is not null) as has_raw from image_candidates where group_id=$1 order by created_at desc limit 100",
    [id],
  );
  return { ...group, candidates: rows };
}
export async function assertGroupApp(group: {
  app_id: string;
  platform: string;
  locale: string;
}) {
  const {
    rows: [workspace],
  } = await pool().query("select apps from workspaces where id='default'");
  const app = workspace?.apps.find(
    (a: { id: string }) => a.id === group.app_id,
  );
  if (
    !app?.[group.platform] ||
    !app.drafts[`${group.platform}:${group.locale}`]
  )
    throw new HttpError(409, "应用平台或语言草稿已被移除，请先在工作台恢复");
}
export async function assertAssets(urls: (string | null)[]) {
  const ids = [
    ...new Set(
      urls.filter((u): u is string => !!u).map((url) => url.split("/").at(-1)),
    ),
  ];
  if (!ids.length) return;
  const found = await pool().query("select id from assets where id=any($1)", [
    ids,
  ]);
  if (found.rowCount !== ids.length)
    throw new HttpError(400, "引用的原始素材不存在");
}
export async function createGroup(input: {
  appId: string;
  platform: string;
  locale: string;
  device: string;
}) {
  await assertGroupApp({
    app_id: input.appId,
    platform: input.platform,
    locale: input.locale,
  });
  try {
    deviceFor(input.device, input.platform);
  } catch {
    throw new HttpError(400, "设备类别与平台不匹配");
  }
  const id = crypto.randomUUID();
  await pool().query(
    "insert into screenshot_groups(id,app_id,platform,locale,device,settings) values($1,$2,$3,$4,$5,$6) on conflict(app_id,platform,locale,device) do nothing",
    [
      id,
      input.appId,
      input.platform,
      input.locale,
      input.device,
      screenshotSettings.parse({}),
    ],
  );
  const {
    rows: [row],
  } = await pool().query(
    "select id from screenshot_groups where app_id=$1 and platform=$2 and locale=$3 and device=$4",
    [input.appId, input.platform, input.locale, input.device],
  );
  return getGroup(row.id);
}
