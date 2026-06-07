/** 用户从 PDF 中划选、加入对话的一段引用 */
export interface Citation {
  id: string;
  /** 选中的文本内容 */
  text: string;
  /** 所在页码（从 1 开始）；来自 AI 回复的引用没有页码 */
  page?: number;
  /** 来源：PDF 文件名，或「AI 回复」 */
  source: string;
}

/** 前端随消息发给 /api/chat 的额外字段 */
export interface ChatRequestBody {
  citations?: Citation[];
  /** 整篇 PDF 全文（启用全文解析时随消息发送，注入到 system 作为文档上下文） */
  fullText?: string;
  /** PDF 文件名，用于全文上下文的标题 */
  pdfName?: string;
}
