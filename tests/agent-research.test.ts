import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  buildAgentUserPrompt,
  createProjectDocumentTools,
  resolveAgentModel,
  uiMessagesToAgentMessages,
} from "@/lib/agentResearch";

function textMessage(role: "user" | "assistant", text: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role,
    parts: [{ type: "text", text }],
  };
}

describe("agent research helpers", () => {
  it("把问题、显式引用和 Open Notebook 上下文合成 agent prompt", () => {
    const prompt = buildAgentUserPrompt({
      question: "比较两篇论文的方法差异",
      contextScope: "project",
      openNotebookContext: "项目上下文：paper A 和 paper B",
      citations: [
        {
          id: "c1",
          text: "A uses attention.",
          source: "a.pdf",
          page: 3,
        },
      ],
    });

    expect(prompt).toContain("用户问题");
    expect(prompt).toContain("比较两篇论文的方法差异");
    expect(prompt).toContain("第 3 页：A uses attention.");
    expect(prompt).toContain("Open Notebook 项目上下文");
  });

  it("把 ChatPaper UIMessage 历史转成 pi agent 消息", () => {
    const messages = uiMessagesToAgentMessages([
      textMessage("user", "hello"),
      textMessage("assistant", "world"),
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(messages[1]).toMatchObject({ role: "assistant", model: "history" });
  });

  it("提供项目 PDF 的 list/search/read 工具", async () => {
    const tools = createProjectDocumentTools([
      {
        id: "pdf-a",
        name: "attention.pdf",
        text: "Transformer attention enables sequence transduction.",
      },
      {
        id: "pdf-b",
        name: "risk.pdf",
        text: "Market risk changes with beliefs about transformative AI.",
      },
    ]);

    const list = await tools[0].execute("call-1", {}, undefined);
    expect(list.details).toEqual({ count: 2 });
    expect(list.content[0].type === "text" ? list.content[0].text : "").toContain(
      "attention.pdf",
    );

    const search = await tools[1].execute(
      "call-2",
      { query: "transformer attention", limit: 1 },
      undefined,
    );
    const searchText = search.content[0].type === "text" ? search.content[0].text : "";
    expect(searchText).toContain("pdf-a");
    expect(searchText).not.toContain("pdf-b");

    const read = await tools[2].execute(
      "call-3",
      { idOrName: "risk", query: "beliefs", charBudget: 1000 },
      undefined,
    );
    const readText = read.content[0].type === "text" ? read.content[0].text : "";
    expect(readText).toContain("risk.pdf");
    expect(readText).toContain("beliefs");
  });

  it("解析项目支持的 pi agent 模型", () => {
    const resolved = resolveAgentModel({
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });

    expect(resolved.provider).toBe("deepseek");
    expect(resolved.model.id).toBe("deepseek-v4-flash");
  });
});
