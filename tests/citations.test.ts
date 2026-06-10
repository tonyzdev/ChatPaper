import { describe, expect, it } from "vitest";
import {
  buildCitationBlock,
  buildDocumentBlock,
  buildDocumentsBlock,
} from "@/lib/citations";
import type { Citation } from "@/lib/types";

const cite = (text: string, page?: number): Citation => ({
  id: "id",
  text,
  page,
  source: "测试来源",
});

describe("buildCitationBlock", () => {
  it("无引用返回 null", () => {
    expect(buildCitationBlock(undefined)).toBeNull();
    expect(buildCitationBlock([])).toBeNull();
  });

  it("带页码的引用标注页码", () => {
    const out = buildCitationBlock([cite("摘要内容", 3)]);
    expect(out).toContain("（第 3 页）摘要内容");
  });

  it("无页码时回落到来源名", () => {
    const out = buildCitationBlock([cite("一段话")]);
    expect(out).toContain("（测试来源）一段话");
  });

  it("单条超长引用按 4000 字符截断", () => {
    const out = buildCitationBlock([cite("x".repeat(5000), 1)]);
    expect(out).toContain("…（已截断）");
    expect(out!.length).toBeLessThan(4200);
  });

  it("超出总预算时省略剩余条目并提示", () => {
    const citations = Array.from({ length: 5 }, (_, i) =>
      cite("y".repeat(4000), i + 1),
    );
    const out = buildCitationBlock(citations, 9000);
    expect(out).toMatch(/其余 \d+ 条引用因长度限制已省略/);
  });
});

describe("buildDocumentBlock", () => {
  it("空文本返回 null", () => {
    expect(buildDocumentBlock(null)).toBeNull();
    expect(buildDocumentBlock("   ")).toBeNull();
  });

  it("包含文件名与全文", () => {
    const out = buildDocumentBlock("正文内容", "论文.pdf");
    expect(out).toContain("《论文.pdf》");
    expect(out).toContain("正文内容");
  });

  it("超出预算按字符截断并提示", () => {
    const out = buildDocumentBlock("z".repeat(100), null, 50);
    expect(out).toContain("…（全文过长已截断");
    expect(out).toContain("z".repeat(50));
    expect(out).not.toContain("z".repeat(51));
  });
});

describe("buildDocumentsBlock", () => {
  it("空列表 / 全空文本返回 null", () => {
    expect(buildDocumentsBlock([])).toBeNull();
    expect(buildDocumentsBlock([{ name: "a.pdf", text: "  " }])).toBeNull();
  });

  it("单篇退化为单文档块", () => {
    const out = buildDocumentsBlock([{ name: "a.pdf", text: "正文" }]);
    expect(out).toContain("《a.pdf》");
    expect(out).toContain("正文");
    expect(out).not.toContain("同时阅读");
  });

  it("多篇分节并提示说明来源", () => {
    const out = buildDocumentsBlock([
      { name: "a.pdf", text: "甲文内容" },
      { name: "b.pdf", text: "乙文内容" },
    ]);
    expect(out).toContain("2 篇 PDF");
    expect(out).toContain("《a.pdf》全文：");
    expect(out).toContain("《b.pdf》全文：");
    expect(out).toContain("哪一篇");
  });

  it("总预算均分到每篇并截断", () => {
    const out = buildDocumentsBlock(
      [
        { name: "a.pdf", text: "x".repeat(100) },
        { name: "b.pdf", text: "y".repeat(100) },
      ],
      100,
    );
    expect(out).toContain("x".repeat(50));
    expect(out).not.toContain("x".repeat(51));
    expect(out).toContain("y".repeat(50));
    expect(out).toContain("…（本篇过长已截断）");
  });
});
