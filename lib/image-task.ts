import { withModelFallback } from "./model-fallback";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { assets, type Job } from "./schema";
import { workerConfig } from "./config-store";
import { configFields } from "./config-model";
import { imageRequest } from "./image-model";
import { assetPath, readFile, storeAsset } from "./storage";
import {
  callImageModel,
  savedReply,
  checkpointReply,
  replyBuffer,
  ImageGenerationError,
} from "./image-provider";
import { finishJob, logJob } from "./job-store";
export async function generateImageTask(job: Job) {
  let sent = false;
  let received = false;
  try {
    const {
      configRevision: _revision,
      screenshotIndex,
      ...request
    } = job.input;
    const { settings, screenshots } = imageRequest.parse(request);
    let reply = await savedReply(job.id);
    if (!reply) {
      const config = await workerConfig("image");
      if (config.revision !== job.input.configRevision)
        throw new ImageGenerationError("图像模型配置已变更，请重新生成");
      const fields = configFields.image.parse(config.fields);
      const references: { buffer: Buffer; mime: string }[] = [];
      const screenshot = screenshots?.[Number(screenshotIndex)];
      for (const url of screenshot
        ? [screenshot, ...settings.references]
        : settings.references) {
        const id = url.split("/").at(-1)!;
        const asset = db().select().from(assets).where(eq(assets.id, id)).get();
        if (!asset) throw new ImageGenerationError("参考图片不存在");
        references.push({
          buffer: await readFile(assetPath(id)),
          mime: asset.mime,
        });
      }
      // Persist before sending. An interrupted request is never automatically sent again.
      finishJob(job.id, "running", { sent: true });
      sent = true;
      logJob(
        job.id,
        "model",
        references.length ? "调用图像编辑 API" : "调用图像生成 API",
      );
      reply = await withModelFallback(fields, job.id, (model, index) =>
        callImageModel(
          { ...fields, model },
          config.secret,
          settings,
          index === 0 ? job.id : randomUUID(),
          references,
        ),
      );
      await checkpointReply(job.id, reply);
    }
    received = true;
    logJob(job.id, "save", "保存模型图片，保留模型输出尺寸");
    const source = await replyBuffer(reply);
    const image = sharp(source, { limitInputPixels: 40000000 });
    const meta = await image.metadata();
    if (
      !["png", "jpeg", "webp"].includes(meta.format ?? "") ||
      (meta.pages ?? 1) > 1
    )
      throw new ImageGenerationError("模型未返回有效的静态图片");
    const output = await image
      .rotate()
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .png()
      .toBuffer();
    if (output.length > 20 * 1024 * 1024)
      throw new ImageGenerationError("生成图片超过 20 MB，请调整模型生成尺寸");
    const asset = await storeAsset(output);
    finishJob(job.id, "succeeded", {
      url: asset.url,
      width: asset.width,
      height: asset.height,
      bytes: asset.bytes,
    });
    logJob(job.id, "complete", "图片已保存，可预览并加入商店截图");
  } catch (error) {
    const known = error instanceof ImageGenerationError;
    const uncertain = known ? error.uncertain : sent && !received;
    const message = known
      ? error.message
      : received
        ? "图片处理或保存失败，模型响应已保留，请检查存储空间。"
        : sent
          ? "模型请求或图片保存失败，调用结果可能已计费，请检查后再决定是否重新生成。"
          : "图片生成失败，请检查模型配置、参考图及存储空间。";
    finishJob(job.id, uncertain ? "uncertain" : "failed", { error: message });
    logJob(job.id, "failed", message);
  }
}
