import { SAMPLE_IMAGE } from "@/lib/sample-image";
import { assertSafeBaseURL } from "@/lib/security";
import { describeImage } from "@/lib/vision";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { apiKey, model, baseURL } = (await req.json()) as {
    apiKey?: string;
    model?: string;
    baseURL?: string;
  };

  if (!apiKey?.trim()) {
    return Response.json({ ok: false, error: "缺少 API Key" });
  }

  try {
    const out = await describeImage(SAMPLE_IMAGE, {
      apiKey,
      model: model?.trim() || "qwen3-vl-flash",
      // 客户端可传任意 baseURL，先过 SSRF 校验
      baseURL:
        assertSafeBaseURL(baseURL) ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
    return Response.json({ ok: true, sample: out.slice(0, 120) });
  } catch (e) {
    return Response.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
