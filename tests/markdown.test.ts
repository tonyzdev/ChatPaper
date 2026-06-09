import { describe, expect, it } from "vitest";
import { normalizeMath } from "@/lib/markdown";

describe("normalizeMath", () => {
  it("把块级 \\[...\\] 转成 $$...$$", () => {
    expect(normalizeMath("结论：\\[E=mc^2\\]")).toBe("结论：$$E=mc^2$$");
  });

  it("把行内 \\(...\\) 转成 $...$", () => {
    expect(normalizeMath("其中 \\(x>0\\) 恒成立")).toBe("其中 $x>0$ 恒成立");
  });

  it("支持跨行公式", () => {
    expect(normalizeMath("\\[\na+b\n\\]")).toBe("$$\na+b\n$$");
  });

  it("不改动代码围栏里的 LaTeX 源码", () => {
    const s = "示例：\n```latex\n\\[E=mc^2\\]\n```\n以及 \\(a\\)";
    expect(normalizeMath(s)).toBe("示例：\n```latex\n\\[E=mc^2\\]\n```\n以及 $a$");
  });

  it("不改动行内代码里的内容", () => {
    const s = "写法是 `\\(x\\)`，渲染后是 \\(x\\)";
    expect(normalizeMath(s)).toBe("写法是 `\\(x\\)`，渲染后是 $x$");
  });

  it("流式中未闭合的代码围栏整体保留", () => {
    const s = "```python\nprint('\\[hi\\]')";
    expect(normalizeMath(s)).toBe(s);
  });

  it("无公式时原样返回", () => {
    expect(normalizeMath("普通文本 $a+b$")).toBe("普通文本 $a+b$");
  });
});
