export type Resolution = {
  model: string;
  target: string;
  requested: string;
  returned: string;
};
export type ImageReview = Resolution & {
  sample?: boolean;
  token: string;
  url: string;
  item: string;
};
export function dimensions(size: string) {
  const match = /^(\d+)x(\d+)$/.exec(size);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}
export function fitsTarget(width: number, height: number, target: string) {
  const size = dimensions(target);
  if (!size) return true;
  const a = width * size.height,
    b = height * size.width;
  return (
    width >= size.width &&
    height >= size.height &&
    Math.min(a, b) >= 0.995 * Math.max(a, b)
  );
}
export function resolutionLabel(r: Resolution) {
  return `${r.model} · 目标 ${r.target} · 请求 ${r.requested} · 返回 ${r.returned}`;
}
