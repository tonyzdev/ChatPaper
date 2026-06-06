import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

export interface VisionConfig {
  apiKey: string;
  model: string;
  baseURL: string;
}

const TRANSCRIBE_PROMPT =
  "请把这张图片的内容尽可能完整地转写为 Markdown 文本：包含其中的所有文字；表格用 Markdown 表格；数学公式用 LaTeX（$...$ 或 $$...$$）；流程图/示意图请描述其结构与关系。只输出转写后的内容，不要添加额外说明。";

/**
 * 用 AI SDK 的 OpenAI 兼容 provider 调用视觉模型（如 Qwen-VL via DashScope
 * compatible-mode），把图片（dataURL/base64 或公网 URL）转写为 Markdown/LaTeX 文本。
 * openai-compatible 走 /chat/completions 并支持 image part，避开 Responses API 的坑。
 */
export async function describeImage(
  imageUrl: string,
  cfg: VisionConfig,
): Promise<string> {
  const provider = createOpenAICompatible({
    name: "vision",
    baseURL: cfg.baseURL.replace(/\/+$/, ""),
    apiKey: cfg.apiKey,
  });

  const { text } = await generateText({
    model: provider(cfg.model),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: TRANSCRIBE_PROMPT },
          { type: "image", image: imageUrl },
        ],
      },
    ],
  });

  return text;
}
