import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

const DEFAULT_ANTHROPIC = "claude-sonnet-4-5";
const DEFAULT_OPENAI = "gpt-4o-mini";

export interface ModelRequest {
  provider?: string;
  apiKey?: string;
  model?: string;
}

/**
 * 解析模型。优先级：
 * 1) 前端传来的 BYOK（apiKey + provider）—— 部署后用户填自己的 key
 * 2) 服务端环境变量（ANTHROPIC_API_KEY / OPENAI_API_KEY）
 * 3) Vercel AI Gateway 字符串模型（需 AI_GATEWAY_API_KEY 或 Vercel OIDC）
 */
export function resolveModel({ provider, apiKey, model }: ModelRequest): LanguageModel {
  const key = apiKey?.trim();

  if (key && provider === "openai") {
    return createOpenAI({ apiKey: key })(model || DEFAULT_OPENAI);
  }
  if (key && provider === "anthropic") {
    return createAnthropic({ apiKey: key })(model || DEFAULT_ANTHROPIC);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return anthropic(model || DEFAULT_ANTHROPIC);
  }
  if (process.env.OPENAI_API_KEY) {
    return openai(model || DEFAULT_OPENAI);
  }

  return (model || "anthropic/claude-sonnet-4.5") as LanguageModel;
}
