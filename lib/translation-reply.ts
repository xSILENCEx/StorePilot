export class TranslationError extends Error {}

export function parseTranslationReply(reply: unknown, expected: string[]) {
  const choice = (
    reply as {
      choices?: { finish_reason?: string; message?: { content?: unknown } }[];
    } | null
  )?.choices?.[0];
  if (choice?.finish_reason === "length")
    throw new TranslationError("文字模型输出被截断");
  if (choice?.finish_reason === "content_filter")
    throw new TranslationError("文字模型过滤了输出内容");
  const content = choice?.message?.content;
  const text = Array.isArray(content)
    ? content
        .filter(
          (part) => part?.type === "text" && typeof part.text === "string",
        )
        .map((part) => part.text)
        .join("")
    : content;
  if (typeof text !== "string" || !text.trim())
    throw new TranslationError("文字模型未返回译文正文");
  const fenced =
    text.match(/\x60\x60\x60(?:json)?\s*([\s\S]*?)\x60\x60\x60/i)?.[1] ?? text;
  let fields: Record<string, unknown>;
  try {
    fields = JSON.parse(
      fenced.slice(fenced.indexOf("{"), fenced.lastIndexOf("}") + 1),
    );
  } catch {
    throw new TranslationError("文字模型正文不是有效 JSON");
  }
  if (!fields || typeof fields !== "object")
    throw new TranslationError("文字模型未返回字段对象");
  if (!expected.some((key) => Object.hasOwn(fields, key))) {
    const nested = fields.fields ?? fields.translations;
    if (nested && typeof nested === "object" && !Array.isArray(nested))
      fields = nested as Record<string, unknown>;
  }
  const result: Record<string, string> = {};
  for (const key of expected) {
    let value = fields?.[key];
    if (
      key === "keywords" &&
      Array.isArray(value) &&
      value.every((v) => typeof v === "string")
    )
      value = value.join(",");
    if (typeof value !== "string" || !value.trim())
      throw new TranslationError("文字模型缺少有效字段：" + key);
    result[key] = value.trim();
  }
  return result;
}

export function fitAppleKeywords(value: string) {
  const selected: string[] = [];
  let bytes = 0;
  for (const raw of value.split(/[,，、]/u)) {
    const term = raw.trim();
    if (!term || selected.includes(term)) continue;
    const cost = Buffer.byteLength(term, "utf8") + (selected.length ? 1 : 0);
    if (bytes + cost <= 100) {
      selected.push(term);
      bytes += cost;
    }
  }
  if (!selected.length)
    throw new TranslationError("模型没有返回可放入 100 字节内的完整关键词");
  return selected.join(",");
}
