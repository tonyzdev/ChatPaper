import type { UIMessage } from "ai";
import type { Citation } from "./types";

function getCitations(m: UIMessage): Citation[] | undefined {
  return (m.metadata as { citations?: Citation[] } | undefined)?.citations;
}

/** 把一条消息的可见内容拼成 Markdown（思考过程不导出，图片转占位） */
function messageBody(m: UIMessage): string {
  return m.parts
    .map((p) => {
      if (p.type === "text") return p.text;
      if (p.type === "file" && p.mediaType?.startsWith("image/")) {
        return `![${p.filename ?? "附件图片"}](${p.url})`;
      }
      return ""; // reasoning 等不导出
    })
    .filter(Boolean)
    .join("\n\n");
}

/** 把整段会话渲染成 Markdown 文本 */
export function conversationToMarkdown(
  messages: UIMessage[],
  opts?: { title?: string; pdfName?: string },
): string {
  const lines: string[] = [`# ${opts?.title?.trim() || "ChatPaper 对话"}`, ""];
  if (opts?.pdfName) {
    lines.push(`> 关联 PDF：${opts.pdfName}`, "");
  }

  for (const m of messages) {
    lines.push(m.role === "user" ? "## 🧑 我" : "## 🤖 AI", "");
    const citations = getCitations(m);
    if (citations?.length) {
      for (const c of citations) {
        const label = c.page != null ? `第 ${c.page} 页` : c.source;
        lines.push(`> 引用（${label}）：${c.text}`);
      }
      lines.push("");
    }
    const body = messageBody(m);
    if (body) lines.push(body, "");
  }

  return `${lines.join("\n").trim()}\n`;
}

/** 把标题清成安全文件名 */
export function safeFileName(title: string | undefined | null): string {
  const base = (title ?? "").replace(/[/\\?%*:|"<>]/g, "-").trim().slice(0, 40);
  return base || "对话";
}

/** 触发浏览器下载一段文本为 .md 文件 */
export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
