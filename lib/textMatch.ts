/**
 * 在 PDF 文本层的 span 文本序列里定位一段引文，返回命中的 span 索引。
 * 思路：把所有 span 文本去空白后拼接（记录每个 span 的起始偏移），
 * 在拼接串里 indexOf 同样去空白的引文 —— 跨行、跨 span、空格差异都不影响。
 * 整句没匹配到时（AI 可能轻微改写），退化用引文前 12 个字符再试。
 */
export function matchSpans(spanTexts: string[], quote: string): number[] {
  const norm = (s: string) => s.replace(/\s+/g, "");
  const q = norm(quote);
  if (!q) return [];

  const starts: number[] = [];
  let concat = "";
  for (const t of spanTexts) {
    starts.push(concat.length);
    concat += norm(t);
  }

  let idx = concat.indexOf(q);
  let len = q.length;
  if (idx === -1 && q.length > 12) {
    const head = q.slice(0, 12);
    idx = concat.indexOf(head);
    len = head.length;
  }
  if (idx === -1) return [];

  const end = idx + len;
  const hits: number[] = [];
  for (let i = 0; i < spanTexts.length; i++) {
    const s = starts[i];
    const e = i + 1 < starts.length ? starts[i + 1] : concat.length;
    if (s < end && e > idx && e > s) hits.push(i);
  }
  return hits;
}
