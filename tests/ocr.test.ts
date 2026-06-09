import { describe, expect, it } from "vitest";
import { cleanOcrText } from "@/lib/ocr";

describe("cleanOcrText", () => {
  it("去掉 grounding 特殊标记", () => {
    expect(cleanOcrText("<|ref|>标题<|/ref|>正文<|grounding|>")).toBe(
      "标题正文",
    );
  });

  it("去掉坐标框", () => {
    expect(cleanOcrText("段落[[12, 34, 56, 78]]结束")).toBe("段落结束");
  });

  it("折叠 3 个以上连续换行", () => {
    expect(cleanOcrText("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("去掉首尾空白", () => {
    expect(cleanOcrText("  \n# 标题\n  ")).toBe("# 标题");
  });
});
