import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import type { UIMessage } from "ai";
import {
  AGENT_RESEARCH_SYSTEM_PROMPT,
  buildAgentUserPrompt,
  createProjectDocumentTools,
  resolveAgentModel,
  uiMessagesToAgentMessages,
  type AgentResearchDocument,
} from "@/lib/agentResearch";
import { isServerKeyAllowed } from "@/lib/security";
import type { Citation } from "@/lib/types";

export const maxDuration = 120;

interface AgentResearchBody {
  prompt?: string;
  messages?: UIMessage[];
  citations?: Citation[];
  provider?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  accessCode?: string;
  deepseekThinking?: boolean;
  documents?: AgentResearchDocument[];
  openNotebookContext?: string;
  contextScope?: "current-pdf" | "project";
}

type AgentWireEvent =
  | { type: "status"; message: string }
  | { type: "text_delta"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

const TOOL_LABELS: Record<string, string> = {
  list_project_documents: "列出项目文档",
  search_project_documents: "检索项目文档",
  read_project_document: "读取文档片段",
};

function eventToWire(event: AgentEvent): AgentWireEvent | null {
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (update.type === "text_delta") {
      return { type: "text_delta", text: update.delta };
    }
    return null;
  }

  if (event.type === "tool_execution_start") {
    return {
      type: "status",
      message: `Agent 正在${TOOL_LABELS[event.toolName] ?? event.toolName}…`,
    };
  }

  if (event.type === "tool_execution_end") {
    return {
      type: "status",
      message: event.isError
        ? `${TOOL_LABELS[event.toolName] ?? event.toolName}失败，Agent 会继续判断。`
        : `${TOOL_LABELS[event.toolName] ?? event.toolName}完成。`,
    };
  }

  if (event.type === "message_end" && event.message.role === "assistant") {
    const message = event.message;
    if ("errorMessage" in message && message.errorMessage) {
      return { type: "error", message: message.errorMessage };
    }
  }

  return null;
}

function writeWireEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: AgentWireEvent,
): void {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

export async function POST(req: Request) {
  let body: AgentResearchBody;
  try {
    body = (await req.json()) as AgentResearchBody;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!isServerKeyAllowed(body.apiKey, body.accessCode)) {
    return Response.json(
      { error: "本站已启用访问口令：请在设置中填入正确口令，或填写你自己的 API Key" },
      { status: 401 },
    );
  }

  let resolved;
  try {
    resolved = resolveAgentModel(body);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return Response.json({ error: "Agent 研究问题不能为空" }, { status: 400 });
  }

  const documents = Array.isArray(body.documents) ? body.documents : [];
  const tools = createProjectDocumentTools(documents);
  const history = uiMessagesToAgentMessages(body.messages ?? []);
  const userPrompt = buildAgentUserPrompt({
    question: prompt,
    citations: body.citations,
    openNotebookContext: body.openNotebookContext,
    contextScope: body.contextScope,
  });

  let agent: Agent | undefined;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: AgentWireEvent) => {
        if (!closed) writeWireEvent(controller, encoder, event);
      };

      agent = new Agent({
        initialState: {
          systemPrompt: AGENT_RESEARCH_SYSTEM_PROMPT,
          model: resolved.model,
          thinkingLevel:
            resolved.provider === "deepseek" && body.deepseekThinking ? "medium" : "off",
          tools,
          messages: history,
        },
        streamFn: (model, context, options) =>
          resolved.models.streamSimple(model, context, options),
        getApiKey: (provider) =>
          provider === resolved.provider ? resolved.apiKey : undefined,
      });

      agent.subscribe((event) => {
        const wire = eventToWire(event);
        if (wire) send(wire);
      });

      send({
        type: "status",
        message:
          documents.length > 0
            ? `Agent 已接入 ${documents.length} 篇已解析 PDF。`
            : "Agent 未收到已解析 PDF，将仅基于问题与外部上下文回答。",
      });

      void agent
        .prompt(userPrompt)
        .then(() => {
          send({ type: "done" });
        })
        .catch((error) => {
          send({ type: "error", message: error instanceof Error ? error.message : String(error) });
        })
        .finally(() => {
          closed = true;
          controller.close();
        });
    },
    cancel() {
      agent?.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
