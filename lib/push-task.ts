import { eq } from "drizzle-orm";
import { configFields } from "./config-model";
import { workerConfig } from "./config-store";
import { finishJob, logJob } from "./job-store";
import { pushGoogle, type PushEntry, type LoadAsset } from "./google-push";
import { pushApple } from "./apple-push";
import { db } from "./db";
import { workspaces, type Job, storeSnapshots } from "./schema";
import { platformSchema, graphicTypes, type GraphicType } from "./model";
import { assetPath, readFile } from "./storage";
import { prepareStoreImage } from "./prepare-store-image";
import { CheckError } from "./connection-check";
import sharp from "sharp";
export async function pushStoreJob(job: Job) {
  const platform = platformSchema.parse(job.platform);
  const report = (msg: string) => logJob(job.id, "push", msg);
  let started = false;
  try {
    const app = db()
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, "default"))
      .get()
      ?.apps.find((a) => a.id === job.app_id);
    const config = await workerConfig(platform, job.app_id);
    if (
      !app ||
      app[platform] !== job.input.identifier ||
      config.revision !== job.input.configRevision
    )
      throw new Error("目标应用或商店连接已变更，请重新确认");
    const entries = job.input.entries as PushEntry[];
    const catalog =
      platform === "apple"
        ? db()
            .select()
            .from(storeSnapshots)
            .where(eq(storeSnapshots.app_id, job.app_id))
            .get()?.current_snapshot.deviceGroups
        : undefined;
    const asset: LoadAsset = async (url) => {
      const bytes = await readFile(assetPath(url.split("/").at(-1)!));
      const meta = await sharp(bytes).metadata();
      return {
        bytes,
        mime: meta.format === "png" ? "image/png" : "image/jpeg",
      };
    };
    for (const entry of entries)
      for (const [group, urls] of Object.entries(entry.groups)) {
        for (const url of urls) {
          const { bytes } = await asset(url);
          const target =
            platform === "google" && graphicTypes.includes(group as GraphicType)
              ? {
                  kind: "graphic" as const,
                  platform,
                  type: group as GraphicType,
                }
              : {
                  kind: "screenshot" as const,
                  platform,
                  appId: job.app_id,
                  group,
                };
          const prepared = await prepareStoreImage(bytes, target, catalog);
          if (!prepared.equals(bytes))
            throw new Error(
              entry.locale + " / " + group + " 尺寸需要调整，请重新上传到草稿",
            );
        }
      }
    started = true;
    if (platform === "google")
      await pushGoogle(
        configFields.google.parse(config.fields).packageName,
        config.secret,
        entries,
        asset,
        report,
      );
    else await pushApple(config, entries, asset, report);
    report("商店已确认资料推送");
    finishJob(job.id, "succeeded", { locales: entries.map((e) => e.locale) });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "推送失败";
    const msg =
      detail + (started ? "。请同步商店资料核对实际状态后再重试。" : "");
    finishJob(
      job.id,
      started && !(e instanceof CheckError && e.status && e.status < 500)
        ? "uncertain"
        : "failed",
      { error: msg },
    );
  }
}
