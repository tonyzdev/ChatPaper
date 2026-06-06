import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { buildSystemPrompt } from "@/lib/citations";
import { resolveModel } from "@/lib/models";
import type { Citation } from "@/lib/types";

// 流式响应，给足时间
export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages, citations }: { messages: UIMessage[]; citations?: Citation[] } =
    await req.json();

  const result = streamText({
    model: resolveModel(),
    system: buildSystemPrompt(citations),
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
