import type { Task } from "graphile-worker";
import sharp from "sharp";
import { pool } from "./db";
import { workerConfig } from "./config-store";
import { configFields } from "./config-model";
import { screenshotSettings, deviceFor } from "./screenshot-model";
import { assetPath, readFile, storeAsset } from "./storage";
import {
  callImageModel,
  savedReply,
  checkpointReply,
  replyBuffer,
  ImageGenerationError,
} from "./image-provider";
import {
  TemplateRenderError,
  normalizeImage,
  renderScreenshot,
  finishScreenshot,
} from "./screenshot-renderer";
export const generateImageTask: Task = async (payload) => {
  const { id } = payload as { id: string };
  const client = await pool().connect();
  let locked = false;
  let candidateId: string | undefined;
  let stage = "prepare";
  const log = async (message: string) => {
    await client.query(
      "insert into job_logs(job_id,step,message) values($1,$2,$3)",
      [id, stage, message],
    );
  };
  try {
    const {
      rows: [job],
    } = await client.query(
      "select * from jobs where id=$1 and kind='generate_image'",
      [id],
    );
    if (!job || job.status === "succeeded") return;
    candidateId = job.input.candidateId;
    const {
      rows: [lock],
    } = await client.query(
      "select pg_try_advisory_lock(hashtextextended($1,0)) as acquired",
      [`image:${candidateId}`],
    );
    if (!lock.acquired) return;
    locked = true;
    const {
      rows: [candidate],
    } = await client.query("select * from image_candidates where id=$1", [
      candidateId,
    ]);
    if (!candidate || candidate.status === "succeeded") return;
    const settings = screenshotSettings.parse(candidate.settings);
    const device = deviceFor(job.input.device);
    await client.query(
      "update image_candidates set status='running',error=null,updated_at=now() where id=$1",
      [candidateId],
    );
    await client.query(
      "update jobs set status='running',updated_at=now() where id=$1",
      [id],
    );
    await log("开始处理冻结的截图配置；已采用结果保持不变");
    let rawUrl: string | null =
      candidate.raw_url ?? job.input.sourceRawUrl ?? null;
    if (settings.mode !== "template" && !rawUrl) {
      stage = "model";
      let reply = await savedReply(candidateId!);
      if (!reply) {
        const {
          rows: [call],
        } = await client.query(
          "select status from image_calls where candidate_id=$1",
          [candidateId],
        );
        if (call)
          throw new ImageGenerationError(
            "上次模型调用没有可恢复的响应，是否已计费未知；不会自动再次调用。需要新图时请明确生成新的候选。",
            true,
          );
        let config;
        try {
          config = await workerConfig("image");
        } catch {
          throw new ImageGenerationError(
            "无法读取图像模型配置或解密 API Key，请检查设置与运行环境主密钥",
          );
        }
        if (config.revision !== job.input.configRevision)
          throw new ImageGenerationError(
            "图像模型配置已变更，请使用新配置重新生成候选",
          );
        const fields = configFields.image.parse(config.fields);
        const urls =
          settings.mode === "template-ai"
            ? [settings.art]
            : [settings.screenshot, settings.art];
        const references = [];
        for (const url of urls.filter((u): u is string => !!u)) {
          const buffer = await readFile(assetPath(url.split("/").at(-1)!));
          const meta = await sharp(buffer).metadata();
          references.push({
            buffer,
            mime: meta.format === "jpeg" ? "image/jpeg" : "image/png",
          });
        }
        if (settings.mode === "template-ai") {
          stage = "preflight";
          await log("先检查真实截图、模板文案与渲染运行时，再调用付费模型");
          await renderScreenshot(settings, device, settings.art);
          stage = "model";
        }
        await client.query(
          "insert into image_calls(candidate_id,status,config_revision) values($1,'started',$2)",
          [candidateId, config.revision],
        );
        await log(
          references.length
            ? "调用图像编辑接口（参考素材将发送至已配置模型）"
            : "调用图像生成接口，每个候选仅请求一张",
        );
        reply = await callImageModel(
          fields,
          config.secret,
          settings,
          job.input.locale,
          candidateId!,
          references,
        );
        await checkpointReply(candidateId!, reply);
      }
      await client.query(
        "update image_calls set status='completed',completed_at=now() where candidate_id=$1",
        [candidateId],
      );
      stage = "download";
      await log("模型响应已保存，后续处理重试不会再次调用模型");
      const buffer = await normalizeImage(await replyBuffer(reply));
      rawUrl = (await storeAsset(buffer)).url;
      await client.query("update image_candidates set raw_url=$2 where id=$1", [
        candidateId,
        rawUrl,
      ]);
    }
    if (rawUrl)
      await client.query("update image_candidates set raw_url=$2 where id=$1", [
        candidateId,
        rawUrl,
      ]);
    stage = "render";
    await log(
      settings.mode === "image-ai"
        ? "将模型整图适配到所选设备尺寸"
        : "渲染固定模板，保留真实截图与可编辑文字",
    );
    const buffer =
      settings.mode === "image-ai"
        ? await readFile(assetPath(rawUrl!.split("/").at(-1)!))
        : await renderScreenshot(settings, device, rawUrl ?? settings.art);
    const output = await finishScreenshot(buffer, settings, device);
    const asset = await storeAsset(output);
    const thumb = await storeAsset(
      await sharp(output)
        .resize({ width: 360, withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer(),
    );
    await client.query("begin");
    await client.query(
      "update image_candidates set status='succeeded',url=$2,thumbnail=$3,raw_url=$4,error=null,updated_at=now() where id=$1",
      [candidateId, asset.url, thumb.url, rawUrl],
    );
    await client.query(
      "update jobs set status='succeeded',result=$2,updated_at=now() where id=$1",
      [
        id,
        {
          candidateId,
          url: asset.url,
          width: device.width,
          height: device.height,
          origin: settings.mode,
        },
      ],
    );
    await log(
      `候选已完成：${device.width} × ${device.height}，${settings.output.toUpperCase()}。请预览后采用。`,
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    const uncertain = error instanceof ImageGenerationError && error.uncertain;
    const safeMessage =
      error instanceof ImageGenerationError ||
      error instanceof TemplateRenderError
        ? error.message
        : stage === "render"
          ? "模板渲染或图片输出失败。请检查 Chromium 运行时（npx playwright install chromium）、源素材和磁盘；可重试处理已保存结果，无需再次生成。"
          : stage === "download"
            ? "下载或解码模型结果失败，原响应已保留；可重试处理，不会再次调用模型。"
            : "截图任务处理失败，请检查素材、数据库和磁盘后重试。";
    if (candidateId)
      await client.query(
        "update image_candidates set status=$2,error=$3,updated_at=now() where id=$1",
        [candidateId, uncertain ? "uncertain" : "failed", safeMessage],
      );
    await client.query(
      "update jobs set status='failed',result=$2,updated_at=now() where id=$1",
      [id, { candidateId, error: safeMessage, stage, uncertain }],
    );
    await log(safeMessage);
  } finally {
    if (locked)
      await client.query("select pg_advisory_unlock(hashtextextended($1,0))", [
        `image:${candidateId}`,
      ]);
    client.release();
  }
};
