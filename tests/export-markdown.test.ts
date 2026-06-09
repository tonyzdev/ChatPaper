import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  conversationToMarkdown,
  safeFileName,
} from "@/lib/exportMarkdown";
import type { Citation } from "@/lib/types";

let nextId = 0;
const userMsg = (text: string, citations?: Citation[]): UIMessage => ({
  id: `u${nextId++}`,
  role: "user",
  parts: [{ type: "text", text }],
  ...(citations ? { metadata: { citations } } : {}),
});
const aiMsg = (text: string): UIMessage => ({
  id: `a${nextId++}`,
  role: "assistant",
  parts: [{ type: "text", text }],
});

describe("conversationToMarkdown", () => {
  it("渲染标题、双方消息", () => {
    const md = conversationToMarkdown([userMsg("你好"), aiMsg("您好")], {
      title: "测试对话",
    });
    expect(md).toContain("# 测试对话");
    expect(md).toContain("## 🧑 我");
    expect(md).toContain("你好");
    expect(md).toContain("## 🤖 AI");
    expect(md).toContain("您好");
  });

  it("无标题用默认", () => {
    expect(conversationToMarkdown([userMsg("hi")])).toContain(
      "# ChatPaper 对话",
    );
  });

  it("带 pdfName 时输出关联行", () => {
    const md = conversationToMarkdown([userMsg("hi")], {
      pdfName: "paper.pdf",
    });
    expect(md).toContain("> 关联 PDF：paper.pdf");
  });

  it("引用按页码 / 来源标注", () => {
    const md = conversationToMarkdown([
      userMsg("解释这段", [
        { id: "c1", text: "原文片段", page: 3, source: "PDF" },
        { id: "c2", text: "AI 片段", source: "AI 回复" },
      ]),
    ]);
    expect(md).toContain("> 引用（第 3 页）：原文片段");
    expect(md).toContain("> 引用（AI 回复）：AI 片段");
  });

  it("图片 part 转 Markdown 图片，reasoning 不导出", () => {
    const m: UIMessage = {
      id: "x",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "内部思考不该出现" },
        { type: "file", mediaType: "image/png", url: "blob:x", filename: "图.png" },
        { type: "text", text: "结论" },
      ],
    };
    const md = conversationToMarkdown([m]);
    expect(md).toContain("![图.png](blob:x)");
    expect(md).toContain("结论");
    expect(md).not.toContain("内部思考");
  });
});

describe("safeFileName", () => {
  it("替换非法字符", () => {
    expect(safeFileName('a/b:c*d?"e')).toBe("a-b-c-d--e");
  });
  it("空标题回落到「对话」", () => {
    expect(safeFileName("")).toBe("对话");
    expect(safeFileName(null)).toBe("对话");
    expect(safeFileName("   ")).toBe("对话");
  });
  it("超长截断到 40", () => {
    expect(safeFileName("字".repeat(100)).length).toBe(40);
  });
});
