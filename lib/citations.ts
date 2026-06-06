import type { Citation } from "./types";

const BASE_SYSTEM = `你是 ChatPaper 的 AI 阅读助手，帮助用户理解 PDF 文献。
- 默认使用简体中文回答，除非用户明确要求其他语言。
- 使用 Markdown 排版；数学公式用 $...$ 或 $$...$$（KaTeX 语法）；代码放进代码块。
- 回答力求准确、简洁、有条理。`;

/**
 * 把用户划选的引用拼进 system prompt。
 * 引用文本可能很长，按总字符预算截断，避免超出上下文。
 */
export function buildSystemPrompt(
  citations: Citation[] | undefined,
  charBudget = 12_000,
): string {
  if (!citations?.length) return BASE_SYSTEM;

  let used = 0;
  const blocks: string[] = [];
  for (let i = 0; i < citations.length; i++) {
    const c = citations[i];
    const text = c.text.length > 4000 ? `${c.text.slice(0, 4000)}…（已截断）` : c.text;
    const block = `【引用 ${i + 1}｜第 ${c.page} 页｜${c.source}】\n${text}`;
    if (used + block.length > charBudget) {
      blocks.push(`（其余 ${citations.length - i} 条引用因长度限制已省略）`);
      break;
    }
    blocks.push(block);
    used += block.length;
  }

  return `${BASE_SYSTEM}

用户从 PDF 中划选了以下内容作为引用。请优先依据这些内容作答，在相关处可注明对应「引用 N」：

${blocks.join("\n\n")}`;
}
