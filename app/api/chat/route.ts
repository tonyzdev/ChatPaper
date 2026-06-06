import {
  convertToModelMessages,
  type ModelMessage,
  streamText,
  type UIMessage,
} from "ai";
import { buildCitationBlock, SYSTEM_PROMPT } from "@/lib/citations";
import { resolveModel } from "@/lib/models";
import type { Citation } from "@/lib/types";

// 流式响应，给足时间
export const maxDuration = 60;

interface ChatBody {
  messages: UIMessage[];
  citations?: Citation[];
  // BYOK：前端在设置里填的 key 随请求发来（HTTPS 加密，服务端不存储）
  provider?: string;
  apiKey?: string;
  model?: string;
}

export async function POST(req: Request) {
  const { messages, citations, provider, apiKey, model }: ChatBody =
    await req.json();

  const modelMessages = await convertToModelMessages(messages);

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

  // DeepSeek 标准 API 不支持图像输入（会报 unknown variant image_url，并污染后续会话），
  // 因此对 deepseek 把图像 part 替换为文字占位。
  if (provider === "deepseek") {
    for (let i = 0; i < modelMessages.length; i++) {
      const m = modelMessages[i];
      if (Array.isArray(m.content)) {
        modelMessages[i] = {
          ...m,
          content: m.content.map((p) =>
            p.type === "image" || p.type === "file"
              ? {
                  type: "text" as const,
                  text: "［图片：暂不支持图像识别］",
                }
              : p,
          ),
        } as ModelMessage;
      }
    }
  }

  const result = streamText({
    model: resolveModel({ provider, apiKey, model }),
    system: SYSTEM_PROMPT,
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse();
}
