import { ocrImage } from "@/lib/ocr";

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
      baseURL: ocr.baseURL?.trim() || "https://api.siliconflow.cn/v1",
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
