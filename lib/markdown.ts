// 代码围栏（``` 含流式中未闭合的）与行内代码（`...`）内的内容原样保留，
// 避免把代码示例里的源码误处理。
const CODE_SEGMENT = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;

/** 对非代码段逐段应用 fn，代码段原样保留 */
function outsideCode(s: string, fn: (seg: string) => string): string {
  return s
    .split(CODE_SEGMENT)
    .map((seg, i) => (i % 2 === 1 ? seg : fn(seg)))
    .join("");
}

// AI（尤其 DeepSeek）常用 \(...\) / \[...\] 包裹公式，而 Streamdown/KaTeX 只认
// $...$ / $$...$$，这里统一转换，确保公式能渲染。
export function normalizeMath(s: string): string {
  return outsideCode(s, (seg) =>
    seg
      .replace(/\\\[([\s\S]*?)\\\]/g, (_, m: string) => `$$${m}$$`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_, m: string) => `$${m}$`),
  );
}

// 把 AI 标注的页码引用「【P3】」「【p. 3】」转成页内锚点链接 [📄 p.3](#cp-page-3)，
// Streamdown 会渲染成 <a>，ChatPanel 用事件委托拦截点击并通知阅读器跳转。
// 锚点用 # 前缀（同页锚点不会被 rehype 的 URL 净化掉）。
export function linkifyPageRefs(s: string): string {
  return outsideCode(s, (seg) =>
    seg.replace(
      /【\s*[Pp]\.?\s*(\d+)\s*】/g,
      (_, n: string) => `[📄 p.${n}](#cp-page-${n})`,
    ),
  );
}
