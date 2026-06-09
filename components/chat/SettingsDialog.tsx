"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  type Provider,
  type OcrSettings,
  type TranslationSettings,
  useAppStore,
  type VisionSettings,
} from "@/store/useAppStore";

const MODEL_PRESETS: Record<Provider, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-8"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  openai: ["gpt-5.5", "gpt-5.4-mini"],
};
const MODEL_HINT: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  deepseek: "deepseek-v4-flash",
  openai: "gpt-5.4-mini",
};
const KEY_HINT: Record<Provider, string> = {
  anthropic: "sk-ant-…",
  deepseek: "sk-…",
  openai: "sk-…",
};
const BASE_URL_HINT: Partial<Record<Provider, string>> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
};
const VISION_PRESETS = ["qwen3-vl-flash", "qwen3-vl-plus"];

type TestState = { status: "idle" | "testing" | "ok" | "fail"; msg?: string };

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        {/* DialogContent 关闭时随 Portal 卸载、打开时重新挂载，所以把表单拆成子组件后，
            每次打开都会用 useState 初始值重新读入当前设置 —— 无需在 effect 内同步 setState。 */}
        <SettingsForm onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({ onClose }: { onClose: () => void }) {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);

  const [provider, setProvider] = useState<Provider>(settings.provider);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [accessCode, setAccessCode] = useState(settings.accessCode);
  const [baseURL, setBaseURL] = useState(settings.baseURL);
  const [model, setModel] = useState(settings.model);
  const [translation, setTranslation] = useState<TranslationSettings>(
    settings.translation,
  );
  const [vision, setVision] = useState<VisionSettings>(settings.vision);
  const [thinking, setThinking] = useState(settings.deepseekThinking);
  const [autoParse, setAutoParse] = useState(settings.autoParseFullText);
  const [ocr, setOcr] = useState<OcrSettings>(settings.ocr);
  const [test, setTest] = useState<TestState>({ status: "idle" });

  const save = () => {
    setSettings({
      provider,
      apiKey: apiKey.trim(),
      accessCode: accessCode.trim(),
      baseURL: baseURL.trim(),
      model: model.trim(),
      translation: {
        ...translation,
        apiKey: translation.apiKey.trim(),
        baseURL: translation.baseURL.trim(),
        model: translation.model.trim(),
      },
      vision: { ...vision, apiKey: vision.apiKey.trim(), model: vision.model.trim() },
      deepseekThinking: thinking,
      autoParseFullText: autoParse,
      ocr: {
        ...ocr,
        apiKey: ocr.apiKey.trim(),
        baseURL: ocr.baseURL.trim(),
        model: ocr.model.trim(),
      },
    });
    onClose();
  };

  const canSave =
    apiKey.trim().length > 0 ||
    accessCode.trim().length > 0 ||
    (!translation.useMainModel && translation.apiKey.trim().length > 0) ||
    (ocr.enabled && ocr.apiKey.trim().length > 0);

  const testVision = async () => {
    setTest({ status: "testing" });
    try {
      const res = await fetch("/api/test-vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: vision.apiKey,
          model: vision.model,
          baseURL: vision.baseURL,
        }),
      });
      const data = (await res.json()) as { ok: boolean; sample?: string; error?: string };
      setTest(
        data.ok
          ? { status: "ok", msg: data.sample || "连接成功，可识别图像" }
          : { status: "fail", msg: data.error || "测试失败" },
      );
    } catch (e) {
      setTest({ status: "fail", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>设置</DialogTitle>
        <DialogDescription>
          填入你的 API Key —— 仅保存在本地浏览器，随请求直发到模型，不经第三方存储。
        </DialogDescription>
      </DialogHeader>
      <Tabs className="gap-3" defaultValue="model">
        <TabsList className="w-full">
          <TabsTrigger value="model">模型</TabsTrigger>
          <TabsTrigger value="document">文档</TabsTrigger>
        </TabsList>

        <TabsContent value="model">

      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto py-1">
        <Field label="模型提供商">
          <Select onValueChange={(v) => setProvider(v as Provider)} value={provider}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic（Claude）</SelectItem>
              <SelectItem value="deepseek">DeepSeek</SelectItem>
              <SelectItem value="openai">OpenAI（GPT）</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="API Key">
          <Input
            autoComplete="off"
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={KEY_HINT[provider]}
            type="password"
            value={apiKey}
          />
        </Field>

        <Field label="站点访问口令（不填 API Key、用站点内置模型时需要；自带 Key 可留空）">
          <Input
            autoComplete="off"
            onChange={(e) => setAccessCode(e.target.value)}
            placeholder="站长在服务端配置的 ACCESS_CODE"
            type="password"
            value={accessCode}
          />
        </Field>

        <Field label="模型（点选常用，或手动输入；留空用默认）">
          <Input
            autoComplete="off"
            onChange={(e) => setModel(e.target.value)}
            placeholder={MODEL_HINT[provider]}
            value={model}
          />
          <div className="flex flex-wrap gap-1.5 pt-1.5">
            {MODEL_PRESETS[provider].map((mm) => (
              <Preset key={mm} active={model === mm} onClick={() => setModel(mm)}>
                {mm}
              </Preset>
            ))}
          </div>
        </Field>

        {provider === "anthropic" || provider === "openai" ? (
          <Field label="Base URL（兼容接口；留空使用官方默认）">
            <Input
              autoComplete="off"
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder={BASE_URL_HINT[provider]}
              value={baseURL}
            />
          </Field>
        ) : null}

        {provider === "deepseek" ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
            <div className="flex flex-col">
              <span className="font-medium text-sm">推理模式（思考）</span>
              <span className="text-muted-foreground text-xs">
                开启后 DeepSeek 先思考再作答并展示思考过程（更慢，默认关）
              </span>
            </div>
            <Switch checked={thinking} onCheckedChange={setThinking} />
          </div>
        ) : null}

        <div className="flex flex-col gap-2.5 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="font-medium text-sm">独立翻译模型</span>
              <span className="text-muted-foreground text-xs">
                关闭时跟随对话模型；开启后可用轻量模型处理划选翻译
              </span>
            </div>
            <Switch
              checked={!translation.useMainModel}
              onCheckedChange={(c) =>
                setTranslation((v) => ({ ...v, useMainModel: !c }))
              }
            />
          </div>

          {!translation.useMainModel ? (
            <div className="flex flex-col gap-2.5 border-t pt-2.5">
              <Field label="翻译模型提供商">
                <Select
                  onValueChange={(v) =>
                    setTranslation((t) => ({ ...t, provider: v as Provider }))
                  }
                  value={translation.provider}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic">Anthropic（Claude）</SelectItem>
                    <SelectItem value="deepseek">DeepSeek</SelectItem>
                    <SelectItem value="openai">OpenAI（GPT）</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="翻译 API Key（同 provider 留空复用主 Key）">
                <Input
                  autoComplete="off"
                  onChange={(e) =>
                    setTranslation((t) => ({ ...t, apiKey: e.target.value }))
                  }
                  placeholder={KEY_HINT[translation.provider]}
                  type="password"
                  value={translation.apiKey}
                />
              </Field>

              <Field label="翻译模型（留空用默认）">
                <Input
                  autoComplete="off"
                  onChange={(e) =>
                    setTranslation((t) => ({ ...t, model: e.target.value }))
                  }
                  placeholder={MODEL_HINT[translation.provider]}
                  value={translation.model}
                />
                <div className="flex flex-wrap gap-1.5 pt-1.5">
                  {MODEL_PRESETS[translation.provider].map((mm) => (
                    <Preset
                      active={translation.model === mm}
                      key={mm}
                      onClick={() => setTranslation((t) => ({ ...t, model: mm }))}
                    >
                      {mm}
                    </Preset>
                  ))}
                </div>
              </Field>

              {translation.provider === "anthropic" ||
              translation.provider === "openai" ? (
                <Field label="翻译 Base URL（同 provider 留空复用主 Base URL）">
                  <Input
                    autoComplete="off"
                    onChange={(e) =>
                      setTranslation((t) => ({ ...t, baseURL: e.target.value }))
                    }
                    placeholder={BASE_URL_HINT[translation.provider]}
                    value={translation.baseURL}
                  />
                </Field>
              ) : null}

              {translation.provider === "deepseek" ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">翻译推理模式</span>
                    <span className="text-muted-foreground text-xs">
                      翻译默认建议关闭，速度更快
                    </span>
                  </div>
                  <Switch
                    checked={translation.deepseekThinking}
                    onCheckedChange={(c) =>
                      setTranslation((t) => ({ ...t, deepseekThinking: c }))
                    }
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* 图像转写（给不支持图像的模型，如 DeepSeek） */}
        <div className="flex flex-col gap-2.5 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="font-medium text-sm">图像转写</span>
              <span className="text-muted-foreground text-xs">
                DeepSeek 等不支持图像的模型，先用视觉模型把图转成文字再加入上下文
              </span>
            </div>
            <Switch
              checked={vision.enabled}
              onCheckedChange={(c) => setVision((v) => ({ ...v, enabled: c }))}
            />
          </div>

          {vision.enabled ? (
            <div className="flex flex-col gap-2.5 border-t pt-2.5">
              <Field label="视觉模型 API Key">
                <Input
                  autoComplete="off"
                  onChange={(e) => setVision((v) => ({ ...v, apiKey: e.target.value }))}
                  placeholder="Qwen（DashScope）sk-…"
                  type="password"
                  value={vision.apiKey}
                />
              </Field>
              <Field label="视觉模型">
                <Input
                  autoComplete="off"
                  onChange={(e) => setVision((v) => ({ ...v, model: e.target.value }))}
                  placeholder="qwen3-vl-flash"
                  value={vision.model}
                />
                <div className="flex flex-wrap gap-1.5 pt-1.5">
                  {VISION_PRESETS.map((mm) => (
                    <Preset
                      active={vision.model === mm}
                      key={mm}
                      onClick={() => setVision((v) => ({ ...v, model: mm }))}
                    >
                      {mm}
                    </Preset>
                  ))}
                </div>
              </Field>
              <Field label="Base URL">
                <Input
                  autoComplete="off"
                  onChange={(e) => setVision((v) => ({ ...v, baseURL: e.target.value }))}
                  placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                  value={vision.baseURL}
                />
              </Field>
              <div className="flex items-center gap-2">
                <Button
                  disabled={!vision.apiKey.trim() || test.status === "testing"}
                  onClick={testVision}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {test.status === "testing" ? "测试中…" : "测试连接"}
                </Button>
                {test.status === "ok" ? (
                  <span className="line-clamp-1 text-green-600 text-xs">✓ 可用</span>
                ) : null}
                {test.status === "fail" ? (
                  <span className="line-clamp-1 text-destructive text-xs" title={test.msg}>
                    ✗ {test.msg}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <p className="text-muted-foreground text-xs">
          获取 Key：Anthropic → console.anthropic.com ；DeepSeek → platform.deepseek.com ；OpenAI → platform.openai.com ；Qwen → bailian.console.aliyun.com
        </p>
      </div>
        </TabsContent>

        <TabsContent value="document">
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto py-1">
            <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div className="flex flex-col">
                <span className="font-medium text-sm">自动解析全文</span>
                <span className="text-muted-foreground text-xs">
                  打开 PDF 时自动解析整篇全文，作为对话上下文随消息发送给 AI，让它读过全文再作答；关闭时可在阅读器工具栏手动点「解析全文」。
                </span>
              </div>
              <Switch checked={autoParse} onCheckedChange={setAutoParse} />
            </div>
            <p className="text-muted-foreground text-xs">
              全文在浏览器本地解析，不上传服务器；仅在你发送消息时随该消息发给所配置的模型。过长的全文会按长度截断。
            </p>

            <div className="flex flex-col gap-2.5 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="font-medium text-sm">OCR（扫描件 / 图片识别）</span>
                  <span className="text-muted-foreground text-xs">
                    用硅基流动 DeepSeek-OCR 识别扫描件 PDF 与聊天图片（PDF 无文本层时可在工具栏「OCR 解析」）
                  </span>
                </div>
                <Switch
                  checked={ocr.enabled}
                  onCheckedChange={(c) => setOcr((v) => ({ ...v, enabled: c }))}
                />
              </div>

              {ocr.enabled ? (
                <div className="flex flex-col gap-2.5 border-t pt-2.5">
                  <Field label="SiliconFlow API Key">
                    <Input
                      autoComplete="off"
                      onChange={(e) => setOcr((v) => ({ ...v, apiKey: e.target.value }))}
                      placeholder="sk-…"
                      type="password"
                      value={ocr.apiKey}
                    />
                  </Field>
                  <Field label="OCR 模型">
                    <Input
                      autoComplete="off"
                      onChange={(e) => setOcr((v) => ({ ...v, model: e.target.value }))}
                      placeholder="deepseek-ai/DeepSeek-OCR"
                      value={ocr.model}
                    />
                  </Field>
                  <Field label="Base URL">
                    <Input
                      autoComplete="off"
                      onChange={(e) => setOcr((v) => ({ ...v, baseURL: e.target.value }))}
                      placeholder="https://api.siliconflow.cn/v1"
                      value={ocr.baseURL}
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <DialogFooter>
        <Button onClick={onClose} variant="outline">
          取消
        </Button>
        <Button disabled={!canSave} onClick={save}>
          保存
        </Button>
      </DialogFooter>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium text-muted-foreground text-xs">{label}</span>
      {children}
    </div>
  );
}

function Preset({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        "rounded-md border px-2 py-0.5 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
