import { modelCanvas } from "./image-canvas";
import { dimensions } from "./image-resolution";
import { callImageModel, type ImageModelConfig } from "./image-provider";
import type { ImageSettings } from "./image-model";
import { logJob } from "./job-store";

export async function requestSizedImage(
  jobId: string,
  config: ImageModelConfig,
  secret: string,
  settings: ImageSettings,
  requestId: string,
  references: Parameters<typeof callImageModel>[4],
  translatePrompt?: (canvas: string) => string,
) {
  const target = settings.modelSize;
  const size = dimensions(target);
  const requested = size
    ? modelCanvas(config.model, size.width, size.height)
    : target;
  logJob(
    jobId,
    "canvas",
    `${config.model} · 目标 ${target} · 请求 ${requested}`,
  );
  const reply = await callImageModel(
    config,
    secret,
    {
      ...settings,
      modelSize: requested,
      prompt: translatePrompt?.(requested) ?? settings.prompt,
    },
    requestId,
    references,
  );
  return { ...reply, sizing: { model: config.model, target, requested } };
}
