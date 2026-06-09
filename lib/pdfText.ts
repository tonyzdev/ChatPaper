import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * 在浏览器端用 pdf.js 抽取整篇 PDF 的纯文本（不上传服务器，与 PDF 渲染共用同一份
 * 已加载的 PDFDocumentProxy，避免重复下载/解析）。逐页 await，过程中回调进度，
 * 让 UI 保持响应。同一行的文本片段按原样拼接（pdf.js 通常已用空格分隔片段），
 * 遇到行尾（hasEOL）补换行，页与页之间用空行分隔。
 */
export async function extractPdfText(
  pdf: PDFDocumentProxy,
  onProgress?: (donePages: number, totalPages: number) => void,
): Promise<string> {
  const total = pdf.numPages;
  const pages: string[] = [];

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let buf = "";
    for (const item of content.items) {
      // items 里还可能混入 TextMarkedContent（无 str 字段），跳过
      if (!("str" in item)) continue;
      buf += item.str;
      if (item.hasEOL) buf += "\n";
    }
    page.cleanup();
    pages.push(buf.trim());
    onProgress?.(i, total);
  }

  // 每页前缀「[第 N 页]」标记：让模型知道每段在第几页，回答时可标注来源页供跳转；
  // 同时折叠 3 个以上连续换行避免大段空白
  return pages
    .map((p, i) => `[第 ${i + 1} 页]\n${p}`)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
