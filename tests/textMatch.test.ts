import { describe, expect, it } from "vitest";
import { matchSpans } from "@/lib/textMatch";

describe("matchSpans", () => {
  const spans = [
    "Deep learning models ",
    "require large amounts of data. ",
    "The loss converges ",
    "after 10 epochs of training.",
  ];

  it("命中单个 span", () => {
    expect(matchSpans(spans, "require large amounts")).toEqual([1]);
  });

  it("跨 span 的引文命中多个 span", () => {
    expect(matchSpans(spans, "The loss converges after 10 epochs")).toEqual([
      2, 3,
    ]);
  });

  it("无视空白差异（换行 / 多空格 / 无空格）", () => {
    expect(matchSpans(spans, "loss   converges\nafter")).toEqual([2, 3]);
    expect(matchSpans(spans, "lossconvergesafter10")).toEqual([2, 3]);
  });

  it("中文（无空格）正常匹配", () => {
    const zh = ["本文提出一种", "新的注意力机制，", "在多个数据集上验证。"];
    expect(matchSpans(zh, "新的注意力机制")).toEqual([1]);
    expect(matchSpans(zh, "提出一种新的注意力")).toEqual([0, 1]);
  });

  it("整句没匹配上时退化用前 12 字符", () => {
    // 后半被 AI 改写,但前缀仍是逐字的
    expect(
      matchSpans(spans, "The loss converges rapidly in our experiments"),
    ).toEqual([2]);
  });

  it("完全不匹配返回空", () => {
    expect(matchSpans(spans, "quantum entanglement")).toEqual([]);
  });

  it("空引文 / 空 spans 返回空", () => {
    expect(matchSpans(spans, "   ")).toEqual([]);
    expect(matchSpans([], "anything")).toEqual([]);
  });
});
