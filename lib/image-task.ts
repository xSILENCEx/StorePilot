import { requestSizedImage } from "./sized-image-request";
import { pauseImage, pendingImage } from "./image-review";
import { dimensions, fitsTarget, resolutionLabel } from "./image-resolution";
import { enlargeTranslation } from "./translation-upscale";
import { maxImagePixels } from "./asset-reference";
import { assetIdFromUrl, maxAssetBytes } from "./asset-reference";
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
    const review = pendingImage(job);
    if (review?.sample && job.result?.decision === "accept") {
      const asset = db()
        .select()
        .from(assets)
        .where(eq(assets.id, assetIdFromUrl(review.url)))
        .get();
      if (!asset) throw new ImageGenerationError("样图不存在");
      finishJob(job.id, "succeeded", {
        url: review.url,
        width: asset.width,
        height: asset.height,
        bytes: asset.bytes,
        resolution: review,
      });
      return;
    }
    if (review && job.result?.decision === "enhance") {
      const target = dimensions(review.target)!;
      const bytes = await readFile(assetPath(assetIdFromUrl(review.url)));
      const enhanced = await storeAsset(
        await enlargeTranslation(bytes, target.width, target.height, true),
      );
      finishJob(job.id, "succeeded", {
        url: enhanced.url,
        width: enhanced.width,
        height: enhanced.height,
        bytes: enhanced.bytes,
        resolution: review,
        originalUrl: review.url,
      });
      return;
    }
    const attempt = review ? String(job.result?.attempt) : job.id;
    let reply = await savedReply(attempt);
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
        const id = assetIdFromUrl(url);
        const asset = db().select().from(assets).where(eq(assets.id, id)).get();
        if (!asset) throw new ImageGenerationError("参考图片不存在");
        references.push({
          buffer: await readFile(assetPath(id)),
          mime: asset.mime,
        });
      }
      // Persist before sending. An interrupted request is never automatically sent again.
      finishJob(job.id, "running", { ...job.result, sent: true });
      sent = true;
      logJob(
        job.id,
        "model",
        references.length ? "调用图像编辑 API" : "调用图像生成 API",
      );
      reply = await withModelFallback(fields, job.id, (model, index) =>
        requestSizedImage(
          job.id,
          { ...fields, model },
          config.secret,
          settings,
          index === 0 ? attempt : randomUUID(),
          references,
        ),
      );
      await checkpointReply(attempt, reply);
    }
    received = true;
    logJob(job.id, "save", "读取并校验模型输出尺寸");
    const source = await replyBuffer(reply);
    const image = sharp(source, { limitInputPixels: maxImagePixels });
    const meta = await image.metadata();
    if (
      !["png", "jpeg", "webp"].includes(meta.format ?? "") ||
      (meta.pages ?? 1) > 1
    )
      throw new ImageGenerationError("模型未返回有效的静态图片");
    const { width, height } = meta.autoOrient;
    const resolution = {
      ...(reply.sizing ?? {
        model: "历史任务",
        target: settings.modelSize,
        requested: "未记录",
      }),
      returned: width + "x" + height,
    };
    logJob(job.id, "resolution", resolutionLabel(resolution));
    const fits = fitsTarget(width, height, resolution.target);
    const target = dimensions(resolution.target);
    if (fits && target && (width !== target.width || height !== target.height))
      image.resize(target.width, target.height, {
        fit: "cover",
        withoutEnlargement: true,
      });
    const output = await image
      .rotate()
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .png()
      .toBuffer();
    if (output.length > maxAssetBytes)
      throw new ImageGenerationError("生成图片超过 20 MB，请调整模型生成尺寸");
    const asset = await storeAsset(output);
    if (fits && job.input.previewFirst && screenshotIndex === 0) {
      pauseImage(job, resolution, asset.url, "首张样图", undefined, true);
      return;
    }
    if (!fits) {
      pauseImage(job, resolution, asset.url, "生成图片");
      return;
    }
    finishJob(job.id, "succeeded", {
      resolution,
      url: asset.url,
      width: asset.width,
      height: asset.height,
      bytes: asset.bytes,
    });
    logJob(job.id, "complete", "图片已保存，可预览并加入商店截图");
  } catch (error) {
    if (pendingImage(job)) {
      finishJob(job.id, "paused", {
        ...job.result,
        review: { ...(job.result?.review as object), token: randomUUID() },
        error: error instanceof Error ? error.message : "处理失败，请核对原图",
      });
      return;
    }
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
