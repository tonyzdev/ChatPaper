import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek, deepseek } from "@ai-sdk/deepseek";
import { createOpenAI, openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { assertSafeBaseURL } from "./security";

const DEFAULT_ANTHROPIC = "claude-sonnet-4-5";
const DEFAULT_OPENAI = "gpt-4o-mini";
const DEFAULT_DEEPSEEK = "deepseek-v4-flash";

export interface ModelRequest {
  provider?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

/**
 * 解析模型。优先级：
 * 1) 前端传来的 BYOK（apiKey + provider）—— 部署后用户填自己的 key
 * 2) 服务端环境变量（ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY；
 *    可用 CHAT_PROVIDER 强制指定 provider、CHAT_MODEL 指定默认模型）
 * 3) Vercel AI Gateway 字符串模型（需 AI_GATEWAY_API_KEY 或 Vercel OIDC）
 *
 * 注：DeepSeek 用官方 @ai-sdk/deepseek（走 /chat/completions）。其标准 API 暂不支持
 * 图像输入，图像在 route 层被过滤为文字占位。
 */
export function resolveModel({ provider, apiKey, baseURL, model }: ModelRequest): LanguageModel {
  const key = apiKey?.trim();
  // 客户端可任意指定 baseURL，必须先过 SSRF 校验（lib/security.ts），不合法直接抛错
  const providerBaseURL = assertSafeBaseURL(baseURL);

  if (key && provider === "openai") {
    return createOpenAI({ apiKey: key, baseURL: providerBaseURL })(model || DEFAULT_OPENAI);
  }
  if (key && provider === "deepseek") {
    return createDeepSeek({ apiKey: key })(model || DEFAULT_DEEPSEEK);
  }
  if (key && provider === "anthropic") {
    return createAnthropic({ apiKey: key, baseURL: providerBaseURL })(model || DEFAULT_ANTHROPIC);
  }

  const envProvider = process.env.CHAT_PROVIDER?.trim().toLowerCase();
  const envModel = process.env.CHAT_MODEL?.trim();
  const wants = (p: string) => !envProvider || envProvider === p;

  if (wants("anthropic") && process.env.ANTHROPIC_API_KEY) {
    return anthropic(model || envModel || DEFAULT_ANTHROPIC);
  }
  if (wants("openai") && process.env.OPENAI_API_KEY) {
    return openai(model || envModel || DEFAULT_OPENAI);
  }
  if (wants("deepseek") && process.env.DEEPSEEK_API_KEY) {
    return deepseek(model || envModel || DEFAULT_DEEPSEEK);
  }

  return (model || envModel || "anthropic/claude-sonnet-4.5") as LanguageModel;
}
