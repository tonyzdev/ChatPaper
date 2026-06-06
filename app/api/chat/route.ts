import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { buildSystemPrompt } from "@/lib/citations";
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

  const result = streamText({
    model: resolveModel({ provider, apiKey, model }),
    system: buildSystemPrompt(citations),
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
