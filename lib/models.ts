import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * 解析要使用的模型。provider 无关：
 * - 设了 ANTHROPIC_API_KEY → 用 Anthropic（默认 claude-sonnet-4-5）
 * - 设了 OPENAI_API_KEY    → 用 OpenAI（默认 gpt-4o-mini）
 * - 都没设               → 走 Vercel AI Gateway，直接传字符串模型 id（需 AI_GATEWAY_API_KEY）
 * 可用 CHAT_PROVIDER / CHAT_MODEL 显式覆盖。
 */
export function resolveModel(): LanguageModel {
  const model = process.env.CHAT_MODEL?.trim();
  const provider = process.env.CHAT_PROVIDER?.trim().toLowerCase();

  if (provider === "openai" || (!provider && process.env.OPENAI_API_KEY)) {
    return openai(model || "gpt-4o-mini");
  }
  if (provider === "anthropic" || (!provider && process.env.ANTHROPIC_API_KEY)) {
    return anthropic(model || "claude-sonnet-4-5");
  }
  // Vercel AI Gateway：字符串模型 id 直接作为 LanguageModel
  return (model || "anthropic/claude-sonnet-4.5") as LanguageModel;
}
