import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildConversationNoteContent,
  buildOpenNotebookContext,
  buildPdfSourceTitle,
  extractConversationId,
  formatOpenNotebookContext,
  hashText,
  parsePdfSourceTitle,
  stripConversationMarker,
  stripPdfSourceTitle,
  syncProjectToOpenNotebook,
} from "@/lib/openNotebook";

function userMessage(text: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Open Notebook helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("为 PDF source title 编码并解析本地 id / hash", () => {
    const title = buildPdfSourceTitle(
      "pdf-123",
      "attention-is-all-you-need.pdf",
      "abcdef1234567890",
    );

    expect(parsePdfSourceTitle(title)).toEqual({
      pdfId: "pdf-123",
      hash: "abcdef123456",
      name: "attention-is-all-you-need.pdf",
    });
    expect(stripPdfSourceTitle(title)).toBe("attention-is-all-you-need.pdf");
  });

  it("把对话转成可同步到 Open Notebook 的 note 内容", () => {
    const messageWithCitation: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      metadata: {
        citations: [
          {
            id: "c1",
            text: "Transformer uses attention",
            page: 3,
            source: "paper.pdf",
          },
        ],
      },
      parts: [{ type: "text", text: "请解释这段话。" }],
    };

    const assistantMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [
        { type: "text", text: "好的，我来解释。" },
        {
          type: "file",
          url: "blob:demo",
          mediaType: "image/png",
          filename: "figure-1.png",
        },
      ],
    };

    const content = buildConversationNoteContent(
      {
        id: "conv-1",
        title: "方法讨论",
        messages: [messageWithCitation, assistantMessage],
      },
      ["paper.pdf"],
    );

    expect(extractConversationId(content)).toBe("conv-1");
    expect(stripConversationMarker(content)).toContain("# 方法讨论");
    expect(content).toContain("> 引用（第 3 页）：Transformer uses attention");
    expect(content).toContain("[图片：figure-1.png]");
  });

  it("把 Open Notebook 返回的 sources / notes 格式化成项目上下文", () => {
    const context = formatOpenNotebookContext("Transformer 项目", {
      sources: [
        {
          title: buildPdfSourceTitle("pdf-1", "paper.pdf", "abcdef123456"),
          full_text: "[第 1 页]\nTransformer is a sequence transduction model.",
        },
      ],
      notes: [
        {
          title: "ChatPaper 对话：相关工作",
          content:
            "<!-- chatpaper-conversation:conv-2 -->\n# 相关工作\n\n## 用户\n请对比 BERT。",
        },
      ],
    });

    expect(context).toContain("以下是来自 Open Notebook 项目《Transformer 项目》");
    expect(context).toContain("## 文档：paper.pdf");
    expect(context).toContain("## 历史对话：相关工作");
    expect(context).not.toContain("chatpaper-conversation");
    expect(context).not.toContain("[ChatPaper PDF:");
  });

  it("生成稳定的 SHA-256 文本 hash", async () => {
    const [first, second] = await Promise.all([
      hashText("same text"),
      hashText("same text"),
    ]);

    expect(first).toHaveLength(64);
    expect(first).toBe(second);
  });

  it("在空上下文时返回 null", () => {
    expect(formatOpenNotebookContext("空项目", { sources: [], notes: [] })).toBeNull();
  });

  it("保留原始 title 当它不是 ChatPaper source marker", () => {
    expect(stripPdfSourceTitle("regular title")).toBe("regular title");
  });

  it("允许普通消息生成最小对话 note", () => {
    const content = buildConversationNoteContent({
      id: "conv-min",
      title: "简短对话",
      messages: [userMessage("hello")],
    });

    expect(content).toContain("## 用户");
    expect(content).toContain("hello");
  });

  it("同步项目时会创建 notebook / source / note", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({ id: "nb-1", name: "项目 A", description: "Synced" }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: "src-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "note-1" }));

    const result = await syncProjectToOpenNotebook({
      connection: { baseUrl: "http://localhost:5055", password: "secret" },
      project: { id: "project-1", name: "项目 A" },
      documents: [{ id: "pdf-1", name: "paper.pdf", text: "全文内容" }],
      conversations: [
        {
          id: "conv-1",
          title: "第一次讨论",
          messages: [userMessage("请总结全文")],
        },
      ],
    });

    expect(result).toEqual({ notebookId: "nb-1" });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:5055/api/notebooks",
    );
  });

  it("构建上下文时会排除当前对话 note", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "src-1",
            title: buildPdfSourceTitle("pdf-1", "paper.pdf", "abcdef123456"),
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "note-current",
            title: "ChatPaper 对话：当前",
            content: "<!-- chatpaper-conversation:conv-current -->\n当前对话",
          },
          {
            id: "note-other",
            title: "ChatPaper 对话：历史",
            content: "<!-- chatpaper-conversation:conv-old -->\n历史对话内容",
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          context: {
            sources: [
              {
                title: buildPdfSourceTitle(
                  "pdf-1",
                  "paper.pdf",
                  "abcdef123456",
                ),
                full_text: "文档内容",
              },
            ],
            notes: [
              {
                title: "ChatPaper 对话：历史",
                content:
                  "<!-- chatpaper-conversation:conv-old -->\n历史对话内容",
              },
            ],
          },
          token_count: 123,
          char_count: 456,
        }),
      );

    const context = await buildOpenNotebookContext({
      connection: { baseUrl: "http://localhost:5055" },
      notebookId: "nb-1",
      projectName: "项目 A",
      currentConversationId: "conv-current",
    });

    expect(context).toContain("历史对话内容");
    expect(context).not.toContain("当前对话");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "POST" });
  });

  it("当前 PDF 范围只请求对应 source，不请求项目 notes", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "src-1",
            title: buildPdfSourceTitle("pdf-1", "first.pdf", "abcdef123456"),
          },
          {
            id: "src-2",
            title: buildPdfSourceTitle("pdf-2", "second.pdf", "abcdef123456"),
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "note-1",
            title: "ChatPaper 对话：历史",
            content: "<!-- chatpaper-conversation:conv-old -->\n历史对话内容",
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          context: {
            sources: [
              {
                title: buildPdfSourceTitle("pdf-2", "second.pdf", "abcdef123456"),
                full_text: "第二篇内容",
              },
            ],
            notes: [],
          },
          token_count: 12,
          char_count: 34,
        }),
      );

    const context = await buildOpenNotebookContext({
      connection: { baseUrl: "http://localhost:5055" },
      notebookId: "nb-1",
      projectName: "项目 A",
      currentPdfId: "pdf-2",
      scope: "current-pdf",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));

    expect(context).toContain("当前 PDF 上下文");
    expect(context).toContain("第二篇内容");
    expect(body.context_config.sources).toEqual({ "src-2": "full content" });
    expect(body.context_config.notes).toEqual({});
  });
});
