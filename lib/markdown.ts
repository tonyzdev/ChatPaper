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

// markdown 链接 URL 里的 ( ) ! ' * 不会被 encodeURIComponent 编码，
// 但会截断 / 干扰链接解析，这里补编码（decodeURIComponent 可正常还原）
function encodeForMdUrl(s: string): string {
  return encodeURIComponent(s).replace(
    /[()!'*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// 把 AI 标注的页码引用转成页内锚点链接，Streamdown 渲染成 <a> 后由
// ChatPanel 的自定义组件接管点击、通知阅读器跳转：
//   【P3】          → [📄 p.3](#cp-page-3)               页级定位
//   【P3:原文片段】 → [📄 p.3](#cp-page-3?q=<encoded>)   句级定位（片段用于文本层匹配）
export function linkifyPageRefs(s: string): string {
  return outsideCode(s, (seg) =>
    seg.replace(
      /【\s*[Pp]\.?\s*(\d+)\s*(?:[:：]\s*([^】]{1,120}?)\s*)?】/g,
      (_, n: string, quote?: string) =>
        quote
          ? `[📄 p.${n}](#cp-page-${n}?q=${encodeForMdUrl(quote)})`
          : `[📄 p.${n}](#cp-page-${n})`,
    ),
  );
}
