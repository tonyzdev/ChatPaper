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

  let working = messages;

  // DeepSeek 不支持图像输入：把最后一条 user 的图替换为前端转写好的文本，其余历史图占位
  if (provider === "deepseek") {
    const transcripts = imageTranscriptions ?? [];
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    let cursor = 0;
    working = messages.map((m, idx) => {
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

  // 全文解析开启时，把整篇 PDF 注入到 system，让模型读过全文再作答
  const docBlock = buildDocumentBlock(fullText, pdfName);
  const system = docBlock ? `${SYSTEM_PROMPT}\n\n${docBlock}` : SYSTEM_PROMPT;

  const result = streamText({
    model: chatModel,
    system,
    messages: modelMessages,
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
