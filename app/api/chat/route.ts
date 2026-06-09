import {
  convertToModelMessages,
  type LanguageModel,
  type ModelMessage,
  streamText,
  type UIMessage,
} from "ai";
import {
  buildCitationBlock,
  buildDocumentBlock,
  SYSTEM_PROMPT,
} from "@/lib/citations";
import { resolveModel } from "@/lib/models";
import { isServerKeyAllowed } from "@/lib/security";
import type { Citation } from "@/lib/types";

export const maxDuration = 60;

interface ChatBody {
  messages: UIMessage[];
  citations?: Citation[];
  // BYOK：前端在设置里填的 key 随请求发来（HTTPS 加密，服务端不存储）
  provider?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  // 站点访问口令：服务端配置 ACCESS_CODE 后，使用站点内置 Key 时必须携带
  accessCode?: string;
  // DeepSeek 不支持图像：前端用视觉模型转写好后随消息发来（按最后一条 user 的图顺序）
  imageTranscriptions?: (string | null)[];
  deepseekThinking?: boolean;
  // 全文解析：前端把整篇 PDF 文本随消息发来，注入 system 作为文档上下文
  fullText?: string;
  pdfName?: string;
}

const isImagePart = (p: UIMessage["parts"][number]) =>
  p.type === "file" && p.mediaType?.startsWith("image/");

/**
 * 长对话上下文窗口：从最新往回保留约 charBudget 字符的消息，更早的丢弃。
 * 不截会让每轮请求线性变贵，聊得久还会撞上下文上限。
 * 非文本 part（图片等）按固定 2000 字符估算；截断起点对齐到 user 消息，
 * 避免发给模型的历史以 assistant 开头。
 */
export function truncateHistory(
  messages: UIMessage[],
  charBudget = 120_000,
): UIMessage[] {
  let used = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const size = messages[i].parts.reduce(
      (n, p) =>
        n + ("text" in p && typeof p.text === "string" ? p.text.length : 2000),
      0,
    );
    if (used + size > charBudget && start < messages.length) break;
    used += size;
    start = i;
  }
  while (start > 0 && start < messages.length && messages[start].role !== "user") {
    start++;
  }
  return start <= 0 ? messages : messages.slice(start);
}

// Anthropic 显式 prompt caching 断点；其他 provider 会忽略该字段
// （OpenAI/DeepSeek 是自动缓存，无需标记）
const CACHE_EPHEMERAL = {
  anthropic: { cacheControl: { type: "ephemeral" as const } },
};

export async function POST(req: Request) {
  const {
    messages,
    citations,
    provider,
    apiKey,
    baseURL,
    model,
    accessCode,
    imageTranscriptions,
    deepseekThinking,
    fullText,
    pdfName,
  }: ChatBody = await req.json();

  if (!isServerKeyAllowed(apiKey, accessCode)) {
    return Response.json(
      { error: "本站已启用访问口令：请在设置中填入正确口令，或填写你自己的 API Key" },
      { status: 401 },
    );
  }

  let chatModel: LanguageModel;
  try {
    chatModel = resolveModel({ provider, apiKey, baseURL, model });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  let working = truncateHistory(messages);

  // DeepSeek 不支持图像输入：把最后一条 user 的图替换为前端转写好的文本，其余历史图占位
  if (provider === "deepseek") {
    const transcripts = imageTranscriptions ?? [];
    const truncated = working;
    let lastUserIdx = -1;
    for (let i = truncated.length - 1; i >= 0; i--) {
      if (truncated[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    let cursor = 0;
    working = truncated.map((m, idx) => {
      const parts = m.parts ?? [];
      if (!parts.some(isImagePart)) return m;
      const newParts: UIMessage["parts"] = [];
      for (const p of parts) {
        if (isImagePart(p)) {
          let text = "［图片：暂不支持图像识别］";
          if (idx === lastUserIdx) {
            const t = transcripts[cursor++];
            if (t) text = `［图片转写］\n${t}`;
          }
          newParts.push({ type: "text", text });
        } else {
          newParts.push(p);
        }
      }
      return { ...m, parts: newParts };
    });
  }

  const modelMessages = await convertToModelMessages(working);

  // 把引用注入到最后一条 user 消息，确保模型在对话上下文中直接看到
  const citeBlock = buildCitationBlock(citations);
  if (citeBlock) {
    let idx = -1;
    for (let i = modelMessages.length - 1; i >= 0; i--) {
      if (modelMessages[i].role === "user") {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      const m = modelMessages[idx];
      const content =
        typeof m.content === "string"
          ? `${citeBlock}\n\n---\n\n${m.content}`
          : [
              { type: "text" as const, text: `${citeBlock}\n\n---\n\n` },
              ...m.content,
            ];
      modelMessages[idx] = { ...m, content } as ModelMessage;
    }
  }

  // 全文解析开启时，把整篇 PDF 作为独立 system 消息注入，并打 Anthropic
  // 缓存断点：长全文每轮重复计费是成本大头，命中缓存后该段输入价约 1/10，
  // 首 token 延迟也明显下降（OpenAI/DeepSeek 自动缓存，忽略该标记）
  const docBlock = buildDocumentBlock(fullText, pdfName);
  const systemMessages: ModelMessage[] = docBlock
    ? [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: docBlock, providerOptions: CACHE_EPHEMERAL },
      ]
    : [{ role: "system", content: SYSTEM_PROMPT }];

  // 多轮缓存：最后一条消息也打断点，下一轮请求时整个历史前缀直接命中
  const lastMessage = modelMessages.at(-1);
  if (lastMessage) {
    modelMessages[modelMessages.length - 1] = {
      ...lastMessage,
      providerOptions: CACHE_EPHEMERAL,
    } as ModelMessage;
  }

  const result = streamText({
    model: chatModel,
    messages: [...systemMessages, ...modelMessages],
    // DeepSeek V4：thinking 显式开/关（默认关，开启会输出 reasoning 思考过程）
    providerOptions:
      provider === "deepseek"
        ? {
            deepseek: {
              thinking: { type: deepseekThinking ? "enabled" : "disabled" },
            },
          }
        : undefined,
  });

  return result.toUIMessageStreamResponse({ sendReasoning: true });
}
