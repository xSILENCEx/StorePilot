import { logJob } from "./job-store";
import { assertWorkerActive } from "./worker-context";
import { orderedModels, type ModelSlots } from "./config-model";

export async function withModelFallback<T>(
  fields: ModelSlots,
  jobId: string,
  attempt: (model: string, index: number) => Promise<T>,
) {
  const ids = orderedModels(fields);
  for (const [index, id] of ids.entries()) {
    assertWorkerActive();
    if (ids.length > 1)
      logJob(
        jobId,
        "model_attempt",
        `尝试模型 ${index + 1}/${ids.length}：${id}`,
      );
    try {
      return await attempt(id, index);
    } catch (error) {
      if (index + 1 === ids.length) throw error;
      logJob(
        jobId,
        "model_fallback",
        `${id} 调用失败，切换至 ${ids[index + 1]}`,
      );
    }
  }
  throw new Error("未配置模型");
}
