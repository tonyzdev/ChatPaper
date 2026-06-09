// AI（尤其 DeepSeek）常用 \(...\) / \[...\] 包裹公式，而 Streamdown/KaTeX 只认
// $...$ / $$...$$，这里统一转换，确保公式能渲染。
// 代码围栏（``` 含流式中未闭合的）与行内代码（`...`）内的内容原样保留，
// 避免把代码示例里的 LaTeX 源码误转。
const CODE_SEGMENT = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;

export function normalizeMath(s: string): string {
  return s
    .split(CODE_SEGMENT)
    .map((seg, i) =>
      i % 2 === 1
        ? seg
        : seg
            .replace(/\\\[([\s\S]*?)\\\]/g, (_, m: string) => `$$${m}$$`)
            .replace(/\\\(([\s\S]*?)\\\)/g, (_, m: string) => `$${m}$`),
    )
    .join("");
}
