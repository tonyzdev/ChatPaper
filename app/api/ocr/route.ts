import { ocrImage } from "@/lib/ocr";
import { assertSafeBaseURL } from "@/lib/security";

export const maxDuration = 60;

interface Body {
  imageUrl?: string;
  ocr?: { apiKey?: string; baseURL?: string; model?: string };
}

export async function POST(req: Request) {
  const { imageUrl, ocr }: Body = await req.json();

  if (!imageUrl) {
    return Response.json({ ok: false, error: "缺少图片" });
  }
  if (!ocr?.apiKey?.trim()) {
    return Response.json({ ok: false, error: "未配置 OCR API Key" });
  }

  try {
    const text = await ocrImage(imageUrl, {
      apiKey: ocr.apiKey,
      // 客户端可传任意 baseURL，先过 SSRF 校验
      baseURL: assertSafeBaseURL(ocr.baseURL) || "https://api.siliconflow.cn/v1",
      model: ocr.model?.trim() || "deepseek-ai/DeepSeek-OCR",
    });
    return Response.json({ ok: true, text });
  } catch (e) {
    return Response.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
