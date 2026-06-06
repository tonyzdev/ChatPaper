import { describeImage } from "@/lib/vision";

// 一张写有 "OK" 字样的小测试图（PNG，base64），用于验证视觉模型能否识别图像
const TEST_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAUCAYAAADPym6aAAAAa0lEQVR4nO3WQQqAMAxE0Yl4/yvHhSBSqDViEvjvQDdlOgwUkSStq7sHWdM9wKK6e5DkPqUq3oUkSZL2siVKkiRJ0n9YkiRJkqStLEmSJEnayJYoSZIkSXfYEiVJkiRJN9gSJUmSJOkGW6IkSdJ5LhM6BCsfh3+jAAAAAElFTkSuQmCC";

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
    const out = await describeImage(TEST_IMAGE, {
      apiKey,
      model: model?.trim() || "qwen3-vl-flash",
      baseURL:
        baseURL?.trim() || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
    return Response.json({ ok: true, sample: out.slice(0, 80) });
  } catch (e) {
    return Response.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
