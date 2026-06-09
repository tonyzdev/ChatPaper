export interface OcrConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

/** DeepSeek-OCR 的 grounding 提示词：对整页文档做 OCR 并输出 Markdown。 */
const OCR_PROMPT = "<image>\n<|grounding|>Convert the document to markdown.";

/** DeepSeek-OCR 单次请求的总序列上限是 8192，给输出留 4096。 */
const MAX_TOKENS = 4096;

/**
 * 清掉 DeepSeek-OCR grounding 模式残留的特殊标记与坐标框，
 * 让结果是干净的 Markdown 文本。
 */
export function cleanOcrText(raw: string): string {
  return raw
    .replace(/<\|[^|]*\|>/g, "") // <|ref|> <|/ref|> <|det|> <|grounding|> 等
    .replace(/\[\[[\d,\s]+\]\]/g, "") // [[x1,y1,x2,y2]] 坐标框
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 用硅基流动（SiliconFlow）部署的 DeepSeek-OCR（OpenAI 兼容 /chat/completions）
 * 把一张图片（dataURL / 公网 URL）识别为 Markdown 文本。temperature 0 保证稳定，
 * 默认走 grounding 提示词（实测在整页文档上识别最准）。
 */
export async function ocrImage(
  imageUrl: string,
  cfg: OcrConfig,
): Promise<string> {
  const base = cfg.baseURL.replace(/\/+$/, "");
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: OCR_PROMPT },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  };

  // 逐页 OCR 时偶发的瞬时网络错误 / 5xx 会中断整篇，做几次退避重试
  let res: Response | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
    try {
      res = await fetch(`${base}/chat/completions`, init);
      if (res.status < 500) break;
      lastErr = new Error(`OCR ${res.status}`);
    } catch (e) {
      lastErr = e;
      res = undefined;
    }
  }
  if (!res) {
    throw new Error(
      `OCR 请求失败: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OCR ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return cleanOcrText(data.choices?.[0]?.message?.content ?? "");
}
