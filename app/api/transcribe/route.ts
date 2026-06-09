import { assertSafeBaseURL } from "@/lib/security";
import { describeImage } from "@/lib/vision";

export const maxDuration = 60;

interface Body {
  imageUrl?: string;
  vision?: { apiKey?: string; model?: string; baseURL?: string };
}

export async function POST(req: Request) {
  const { imageUrl, vision }: Body = await req.json();

  if (!imageUrl) {
    return Response.json({ ok: false, error: "缺少图片" });
  }
  if (!vision?.apiKey?.trim()) {
    return Response.json({ ok: false, error: "未配置视觉模型 API Key" });
  }

  try {
    const text = await describeImage(imageUrl, {
      apiKey: vision.apiKey,
      model: vision.model?.trim() || "qwen3-vl-flash",
      // 客户端可传任意 baseURL，先过 SSRF 校验
      baseURL:
        assertSafeBaseURL(vision.baseURL) ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
    return Response.json({ ok: true, text });
  } catch (e) {
    return Response.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
