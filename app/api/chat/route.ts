import {
  convertToModelMessages,
  type ModelMessage,
  streamText,
  type UIMessage,
} from "ai";
import { buildCitationBlock, SYSTEM_PROMPT } from "@/lib/citations";
import { resolveModel } from "@/lib/models";
import type { Citation } from "@/lib/types";
import { describeImage, type VisionConfig } from "@/lib/vision";

// 流式响应，给足时间（含图像转写可能更久）
export const maxDuration = 60;

interface ChatBody {
  messages: UIMessage[];
  citations?: Citation[];
  // BYOK：前端在设置里填的 key 随请求发来（HTTPS 加密，服务端不存储）
  provider?: string;
  apiKey?: string;
  model?: string;
  vision?: { enabled?: boolean } & Partial<VisionConfig>;
}

// 标准 chat API 不支持图像输入的 provider
const NO_VISION = new Set(["deepseek"]);

function isImagePart(p: UIMessage["parts"][number]) {
  return p.type === "file" && p.mediaType?.startsWith("image/");
}

export async function POST(req: Request) {
  const { messages, citations, provider, apiKey, model, vision }: ChatBody =
    await req.json();

  let working = messages;

  // 主模型不支持图像（如 deepseek）：把图像 part 处理掉
  if (provider && NO_VISION.has(provider)) {
    const canTranscribe = !!(vision?.enabled && vision.apiKey?.trim());
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }

    working = await Promise.all(
      messages.map(async (m, idx) => {
        const parts = m.parts ?? [];
        if (!parts.some(isImagePart)) return m;

        const newParts: UIMessage["parts"] = [];
        for (const p of parts) {
          if (!isImagePart(p) || p.type !== "file") {
            newParts.push(p);
            continue;
          }
          // 仅对最后一条 user 消息的图做转写（避免历史图每轮重复转写、费用累积）
          if (idx === lastUserIdx && canTranscribe) {
            try {
              const desc = await describeImage(p.url, {
                apiKey: vision!.apiKey!,
                model: vision!.model || "qwen3-vl-flash",
                baseURL:
                  vision!.baseURL ||
                  "https://dashscope.aliyuncs.com/compatible-mode/v1",
              });
              newParts.push({ type: "text", text: `［图片转写］\n${desc}` });
            } catch {
              newParts.push({ type: "text", text: "［图片：转写失败］" });
            }
          } else {
            newParts.push({ type: "text", text: "［图片：暂不支持图像识别］" });
          }
        }
        return { ...m, parts: newParts };
      }),
    );
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

  const result = streamText({
    model: resolveModel({ provider, apiKey, model }),
    system: SYSTEM_PROMPT,
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse();
}
