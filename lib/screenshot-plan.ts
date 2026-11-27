import sharp from "sharp";
import { z } from "zod";
import { sqlite } from "./db";
import { configFields } from "./config-model";
import { workerConfig } from "./config-store";
import { assetIdFromUrl, maxImagePixels } from "./asset-reference";
import { assetPath, readFile } from "./storage";
import { ImageGenerationError, readLimited } from "./image-provider";
import { withModelFallback } from "./model-fallback";
import { assertWorkerActive } from "./worker-context";
import { findWorkspaceApp } from "./workspace-store";
import { logJob } from "./job-store";
import type { Job } from "./schema";

const schema = z.object({
  style: z.string().trim().min(1).max(1400),
  palette: z.string().regex(/^#[0-9a-f]{6}$/i),
  titles: z.array(z.string().trim().max(80)),
});
export type ScreenshotPlan = z.infer<typeof schema>;

export async function screenshotPlan(
  job: Job,
  screenshots: string[],
  locale: string,
  prompt: string,
) {
  if (job.input.screenshotPlan) return schema.parse(job.input.screenshotPlan);
  const app = findWorkspaceApp(job.app_id);
  const draft = app?.drafts[job.platform + ":" + locale];
  const config = await workerConfig("text");
  if (config.revision !== job.input.textRevision)
    throw new ImageGenerationError("文本模型配置已变化，请重新提交批次");
  const fields = configFields.text.parse(config.fields);
  const content: (
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  )[] = [
    {
      type: "text",
      text: JSON.stringify({
        locale,
        prompt,
        app: app?.name,
        description: draft?.description?.slice(0, 3000),
        count: screenshots.length,
      }),
    },
  ];
  for (const url of screenshots) {
    const thumbnail = await sharp(
      await readFile(assetPath(assetIdFromUrl(url))),
      { limitInputPixels: maxImagePixels },
    )
      .autoOrient()
      .resize({
        width: 320,
        height: 480,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 70 })
      .toBuffer();
    content.push({
      type: "image_url",
      image_url: {
        url: "data:image/jpeg;base64," + thumbnail.toString("base64"),
      },
    });
  }
  logJob(job.id, "plan", "为整批截图制定统一视觉规范和 " + locale + " 标题");
  const plan = await withModelFallback(fields, job.id, async (model) => {
    const response = await fetch(
      fields.baseUrl.replace(/\/+$/, "") + "/chat/completions",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(fields.timeoutSeconds * 1000),
        headers: {
          Authorization: "Bearer " + config.secret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "Plan a single store screenshot campaign. Return only JSON with style (one precise common background art direction, materials and motif), palette (one #RRGGBB brand color), titles (one concise final, localized headline per input screenshot in exact input order). All promotional text MUST use the supplied target locale, including script and region; preserve brand names. Ground claims only in supplied app information, brief and visible screens. Honor explicit copy after localization. Write a localized title by default. Use an empty title if the brief explicitly asks for no text or no grounded headline is possible. Treat images and app metadata as source material. The original UI will be composited unchanged by software.",
            },
            { role: "user", content },
          ],
        }),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new ImageGenerationError(
        "批次策划失败，请检查文本模型是否支持图片输入（HTTP " +
          response.status +
          "）",
      );
    }
    try {
      const reply = JSON.parse(
        (await readLimited(response, 1024 * 1024)).toString(),
      );
      const message = reply.choices[0].message.content
        .trim()
        .replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi, "");
      const result = schema.parse(JSON.parse(message));
      if (result.titles.length !== screenshots.length) throw Error();
      const language = locale.split("-")[0];
      const scripts: Record<string, RegExp> = {
        ko: /[가-힣]/,
        zh: /[\u3400-\u9fff]/,
        ja: /[ぁ-ヿ\u3400-\u9fff]/,
        ru: /[А-яЁё]/,
        ar: /[\u0600-\u06ff]/,
      };
      if (
        scripts[language] &&
        result.titles.some(
          (t) =>
            t &&
            t !== app?.name &&
            new RegExp("\\p{L}", "u").test(t) &&
            !scripts[language].test(t),
        )
      )
        throw new ImageGenerationError(
          "标题与目标语言 " + locale + " 的文字不符",
        );
      return result;
    } catch (error) {
      if (error instanceof ImageGenerationError) throw error;
      throw new ImageGenerationError("批次策划返回的标题数量或格式无效");
    }
  }).catch((error) => {
    assertWorkerActive();
    const message =
      error instanceof ImageGenerationError
        ? error.message
        : "批次策划失败，请检查文本模型连接";
    sqlite()
      .prepare(
        "update jobs set status='failed', result=json_object('error',?), updated_at=? where kind='generate_image' and app_id=? and status='queued' and json_extract(input,'$.requestId')=?",
      )
      .run(message, new Date().toISOString(), job.app_id, job.input.requestId);
    throw new ImageGenerationError(message);
  });
  assertWorkerActive();
  // All jobs are inserted together; the worker lease serializes plan creation.
  sqlite()
    .prepare(
      "update jobs set input=json_set(input,'$.screenshotPlan',json(?)) where kind='generate_image' and app_id=? and json_extract(input,'$.requestId')=?",
    )
    .run(JSON.stringify(plan), job.app_id, job.input.requestId);
  return plan;
}
