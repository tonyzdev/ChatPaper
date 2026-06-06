import type { Citation } from "./types";

export const SYSTEM_PROMPT = `你是 ChatPaper 的 AI 阅读助手，帮助用户理解 PDF 文献。
- 默认使用简体中文回答，除非用户明确要求其他语言。
- 使用 Markdown 排版；数学公式用 $...$ 或 $$...$$（KaTeX 语法）；代码放进代码块。
- 当用户的消息中带有从 PDF 划选的引用内容时，直接基于这些内容作答，不要再要求用户提供材料。
- 回答力求准确、简洁、有条理。`;

/**
 * 把用户划选的引用拼成一段文本，用于注入到该用户消息里
 * （而非放进 system，确保模型在对话上下文中直接看到）。
 * 按总字符预算截断，避免超出上下文。
 */
export function buildCitationBlock(
  citations: Citation[] | undefined,
  charBudget = 12_000,
): string | null {
  if (!citations?.length) return null;

  let used = 0;
  const blocks: string[] = [];
  for (let i = 0; i < citations.length; i++) {
    const c = citations[i];
    const text =
      c.text.length > 4000 ? `${c.text.slice(0, 4000)}…（已截断）` : c.text;
    const block = `（第 ${c.page} 页）${text}`;
    if (used + block.length > charBudget) {
      blocks.push(`（其余 ${citations.length - i} 条引用因长度限制已省略）`);
      break;
    }
    blocks.push(block);
    used += block.length;
  }

  return `我从这篇 PDF 中划选了以下内容，请基于它回答我的问题：\n\n${blocks.join("\n\n")}`;
}
