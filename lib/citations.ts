import type { Citation } from "./types";

export const SYSTEM_PROMPT = `你是 ChatPaper 的 AI 阅读助手，帮助用户理解 PDF 文献。
- 默认使用简体中文回答，除非用户明确要求其他语言。
- 使用 Markdown 排版；代码放进代码块。
- 数学公式必须用美元符号（KaTeX）：行内用 $...$，块级用 $$...$$。不要用 \\(...\\)、\\[...\\] 或纯括号来包裹公式。
- 当用户的消息中带有从 PDF 划选的引用内容时，直接基于这些内容作答，不要再要求用户提供材料。
- 全文上下文里每页以「[第 N 页]」开头标注页码。当回答引用了原文某处时，在该句末尾用「【P页码:原文片段】」标注来源（如【P3:loss converges after 10 epochs】），其中原文片段必须是从该页逐字抄录的 8~20 个连续字符（保持原文语言，不要翻译或改写），用户可点击跳转并定位到该句；写不出精确原文就只标【P页码】；页码不确定就不标。
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
    const label = c.page != null ? `第 ${c.page} 页` : c.source;
    const block = `（${label}）${text}`;
    if (used + block.length > charBudget) {
      blocks.push(`（其余 ${citations.length - i} 条引用因长度限制已省略）`);
      break;
    }
    blocks.push(block);
    used += block.length;
  }

  return `我从这篇 PDF 中划选了以下内容，请基于它回答我的问题：\n\n${blocks.join("\n\n")}`;
}

/**
 * 把整篇 PDF 全文拼成「文档上下文」，注入到 system，让模型像读过全文一样作答。
 * 超出预算按字符截断（保留开头），避免撑爆上下文窗口。
 */
export function buildDocumentBlock(
  fullText: string | undefined | null,
  fileName?: string | null,
  charBudget = 60_000,
): string | null {
  const text = fullText?.trim();
  if (!text) return null;

  const title = fileName ? `《${fileName}》` : "这篇 PDF";
  const body =
    text.length > charBudget
      ? `${text.slice(0, charBudget)}\n\n…（全文过长已截断，未包含的部分可让用户划选引用补充）`
      : text;

  return `以下是用户正在阅读的 ${title} 的全文，请基于它理解并回答用户的问题：\n\n${body}`;
}

/**
 * 多篇 PDF 的文档上下文：总预算均分到每篇，各篇以《文件名》分节，
 * 便于模型跨文献对比并在回答里说明来源出自哪一篇。
 */
export function buildDocumentsBlock(
  docs: { name: string; text: string }[],
  charBudget = 60_000,
): string | null {
  const valid = docs.filter((d) => d.text.trim());
  if (valid.length === 0) return null;
  if (valid.length === 1) {
    return buildDocumentBlock(valid[0].text, valid[0].name, charBudget);
  }

  const per = Math.floor(charBudget / valid.length);
  const sections = valid.map((d) => {
    const text = d.text.trim();
    const body =
      text.length > per ? `${text.slice(0, per)}\n\n…（本篇过长已截断）` : text;
    return `《${d.name}》全文：\n\n${body}`;
  });

  return `以下是用户正在同时阅读的 ${valid.length} 篇 PDF 的全文，请基于它们理解并回答用户的问题（引用时注意说明来自哪一篇）：\n\n${sections.join("\n\n---\n\n")}`;
}
