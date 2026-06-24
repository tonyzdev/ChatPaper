import { Type, createModels, type Api, type Message, type Model, type Models } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { UIMessage } from "ai";
import type { Citation } from "@/lib/types";
import { assertSafeBaseURL } from "@/lib/security";

export interface AgentResearchDocument {
  id: string;
  name: string;
  text: string;
}

export interface AgentModelRequest {
  provider?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface ResolvedAgentModel {
  models: Models;
  model: Model<Api>;
  provider: "anthropic" | "openai" | "deepseek";
  apiKey?: string;
}

export interface AgentPromptInput {
  question: string;
  citations?: Citation[];
  openNotebookContext?: string;
  contextScope?: "current-pdf" | "project";
}

const DEFAULT_AGENT_MODELS = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.4-mini",
  deepseek: "deepseek-v4-flash",
} as const;

const SUPPORTED_AGENT_PROVIDERS = ["anthropic", "openai", "deepseek"] as const;

function selectedAgentProvider(provider?: string): ResolvedAgentModel["provider"] {
  const requested = provider?.trim().toLowerCase();
  if (SUPPORTED_AGENT_PROVIDERS.some((item) => item === requested)) {
    return requested as ResolvedAgentModel["provider"];
  }

  const envProvider = process.env.CHAT_PROVIDER?.trim().toLowerCase();
  if (SUPPORTED_AGENT_PROVIDERS.some((item) => item === envProvider)) {
    return envProvider as ResolvedAgentModel["provider"];
  }

  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  return "anthropic";
}

export function resolveAgentModel({
  provider,
  apiKey,
  baseURL,
  model,
}: AgentModelRequest): ResolvedAgentModel {
  const models = createModels();
  models.setProvider(anthropicProvider());
  models.setProvider(openaiProvider());
  models.setProvider(deepseekProvider());

  const selected = selectedAgentProvider(provider);
  const modelId = model?.trim() || process.env.CHAT_MODEL?.trim() || DEFAULT_AGENT_MODELS[selected];
  const resolved = models.getModel(selected, modelId);
  if (!resolved) {
    const available = models
      .getModels(selected)
      .slice(0, 12)
      .map((item) => item.id)
      .join("、");
    throw new Error(`Agent 不支持模型 ${selected}/${modelId}。可用示例：${available}`);
  }

  const customBaseUrl = assertSafeBaseURL(baseURL);
  return {
    models,
    model: customBaseUrl ? { ...resolved, baseUrl: customBaseUrl } : resolved,
    provider: selected,
    apiKey: apiKey?.trim() || undefined,
  };
}

function messageText(message: UIMessage): string {
  const parts: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text" && part.text.trim()) parts.push(part.text.trim());
    if (part.type === "file" && part.mediaType?.startsWith("image/")) {
      parts.push(`[图片：${part.filename ?? "附件图片"}]`);
    }
  }
  return parts.join("\n\n");
}

export function uiMessagesToAgentMessages(messages: UIMessage[], limit = 12): Message[] {
  const recent = messages.slice(-limit);
  const converted: Message[] = [];
  for (const message of recent) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = messageText(message);
    if (!text) continue;
    if (message.role === "user") {
      converted.push({ role: "user", content: text, timestamp: Date.now() });
      continue;
    }
    converted.push({
      role: "assistant",
      content: [{ type: "text", text }],
      api: "chatpaper-history",
      provider: "chatpaper",
      model: "history",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
  }
  return converted;
}

function citationBlock(citations?: Citation[]): string | null {
  if (!citations?.length) return null;
  const lines = citations.map((citation, index) => {
    const label = citation.page != null ? `第 ${citation.page} 页` : citation.source;
    return `${index + 1}. ${label}：${citation.text}`;
  });
  return `用户显式引用：\n${lines.join("\n")}`;
}

export function buildAgentUserPrompt({
  question,
  citations,
  openNotebookContext,
  contextScope = "project",
}: AgentPromptInput): string {
  const sections = [`用户问题：\n${question.trim() || "请基于当前材料继续分析。"}`];
  const cites = citationBlock(citations);
  if (cites) sections.push(cites);
  const context = openNotebookContext?.trim();
  if (context) {
    const scopeLabel = contextScope === "current-pdf" ? "当前 PDF" : "项目";
    sections.push(`Open Notebook ${scopeLabel}上下文：\n${context}`);
  }
  return sections.join("\n\n---\n\n");
}

function normalizeSearchTerms(query: string): string[] {
  const terms = query
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return Array.from(new Set(terms)).slice(0, 12);
}

function documentExcerpt(text: string, terms: string[], charBudget: number): string {
  const clean = text.trim();
  if (clean.length <= charBudget) return clean;
  const lower = clean.toLocaleLowerCase();
  let hit = -1;
  for (const term of terms) {
    hit = lower.indexOf(term);
    if (hit >= 0) break;
  }
  if (hit < 0) return `${clean.slice(0, charBudget)}\n…`;
  const half = Math.floor(charBudget / 2);
  const start = Math.max(0, hit - half);
  const end = Math.min(clean.length, start + charBudget);
  const prefix = start > 0 ? "…\n" : "";
  const suffix = end < clean.length ? "\n…" : "";
  return `${prefix}${clean.slice(start, end)}${suffix}`;
}

function documentScore(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const lower = text.toLocaleLowerCase();
  let score = 0;
  for (const term of terms) {
    let index = lower.indexOf(term);
    while (index >= 0) {
      score += 1;
      index = lower.indexOf(term, index + term.length);
      if (score > 1000) break;
    }
  }
  return score;
}

function findDocument(documents: AgentResearchDocument[], idOrName: string) {
  const key = idOrName.trim().toLocaleLowerCase();
  return documents.find(
    (document) =>
      document.id.toLocaleLowerCase() === key ||
      document.name.toLocaleLowerCase() === key ||
      document.name.toLocaleLowerCase().includes(key),
  );
}

export function createProjectDocumentTools(
  documents: AgentResearchDocument[],
): AgentTool[] {
  const prepared = documents
    .map((document) => ({ ...document, text: document.text.trim() }))
    .filter((document) => document.text.length > 0);

  return [
    {
      name: "list_project_documents",
      label: "列出项目文档",
      description: "List the parsed PDF documents available in this ChatPaper project.",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(
              prepared.map((document) => ({
                id: document.id,
                name: document.name,
                characters: document.text.length,
                preview: document.text.slice(0, 500),
              })),
              null,
              2,
            ),
          },
        ],
        details: { count: prepared.length },
      }),
    },
    {
      name: "search_project_documents",
      label: "检索项目文档",
      description:
        "Search parsed PDF text by keywords and return ranked excerpts. Use this before answering cross-document research questions.",
      parameters: Type.Object({
        query: Type.String({ description: "Keywords or phrase to search for" }),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 8 })),
      }),
      execute: async (_toolCallId, params) => {
        const args = params as { query: string; limit?: number };
        const terms = normalizeSearchTerms(args.query);
        const limit = Math.min(Math.max(Math.floor(args.limit ?? 5), 1), 8);
        const results = prepared
          .map((document) => ({
            id: document.id,
            name: document.name,
            score: documentScore(`${document.name}\n${document.text}`, terms),
            excerpt: documentExcerpt(document.text, terms, 2600),
          }))
          .filter((item) => item.score > 0 || terms.length === 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          details: { query: args.query, count: results.length },
        };
      },
    },
    {
      name: "read_project_document",
      label: "读取文档片段",
      description:
        "Read one parsed PDF by id or title. Optionally focus the excerpt around a query.",
      parameters: Type.Object({
        idOrName: Type.String({ description: "Document id or visible PDF title" }),
        query: Type.Optional(Type.String({ description: "Optional focus query" })),
        charBudget: Type.Optional(Type.Number({ minimum: 1000, maximum: 20000 })),
      }),
      execute: async (_toolCallId, params) => {
        const args = params as { idOrName: string; query?: string; charBudget?: number };
        const document = findDocument(prepared, args.idOrName);
        if (!document) throw new Error(`找不到文档：${args.idOrName}`);
        const terms = normalizeSearchTerms(args.query ?? "");
        const charBudget = Math.min(Math.max(Math.floor(args.charBudget ?? 9000), 1000), 20000);
        const excerpt = documentExcerpt(document.text, terms, charBudget);
        return {
          content: [
            {
              type: "text",
              text: `# ${document.name}\n\n${excerpt}`,
            },
          ],
          details: { id: document.id, name: document.name, characters: document.text.length },
        };
      },
    },
  ];
}

export const AGENT_RESEARCH_SYSTEM_PROMPT = `你是 ChatPaper 的项目研究 Agent。你的工作不是快速聊天，而是先检索材料、再给出可核查的研究回答。

工作规则：
- 优先使用工具查看项目 PDF；回答跨文档问题前至少先检索项目文档。
- 如果用户提供了 Open Notebook 上下文，把它视为已检索材料；仍可用工具核对本地已解析 PDF。
- 不编造论文、页码、实验结果或结论。材料里没有就明确说没有找到。
- 回答应给出结构化结论，并标注依据来自哪篇文档或哪段用户引用。
- 中文提问默认用中文回答；保持简洁，但保留关键证据链。`;
