import { describe, expect, it } from "vitest";
import { linkifyPageRefs, normalizeMath } from "@/lib/markdown";

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

describe("linkifyPageRefs", () => {
  it("把 【P3】 转成页内锚点链接", () => {
    expect(linkifyPageRefs("见方法部分【P3】。")).toBe(
      "见方法部分[📄 p.3](#cp-page-3)。",
    );
  });

  it("容忍小写与空格 / 点：【p. 12】", () => {
    expect(linkifyPageRefs("【p. 12】")).toBe("[📄 p.12](#cp-page-12)");
  });

  it("一段里多个引用都转换", () => {
    expect(linkifyPageRefs("如【P1】与【P2】所述")).toBe(
      "如[📄 p.1](#cp-page-1)与[📄 p.2](#cp-page-2)所述",
    );
  });

  it("不动代码块里的同形文本", () => {
    expect(linkifyPageRefs("`【P3】` 是标记")).toBe("`【P3】` 是标记");
  });

  it("带原文片段：【P3:quote】转成 ?q= 链接", () => {
    expect(linkifyPageRefs("如下【P3:loss converges】")).toBe(
      "如下[📄 p.3](#cp-page-3?q=loss%20converges)",
    );
  });

  it("片段里的括号被补编码，不截断 markdown 链接", () => {
    const out = linkifyPageRefs("【P2:f(x) = y】");
    expect(out).toBe("[📄 p.2](#cp-page-2?q=f%28x%29%20%3D%20y)");
    expect(decodeURIComponent(out.match(/q=(.*)\)$/)![1])).toBe("f(x) = y");
  });

  it("中文冒号也支持", () => {
    expect(linkifyPageRefs("【P5：注意力机制】")).toBe(
      "[📄 p.5](#cp-page-5?q=%E6%B3%A8%E6%84%8F%E5%8A%9B%E6%9C%BA%E5%88%B6)",
    );
  });

  it("无页码引用时原样返回", () => {
    expect(linkifyPageRefs("普通文本【备注】")).toBe("普通文本【备注】");
  });
});
