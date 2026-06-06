"use client";

import { useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";
import { type Provider, useAppStore } from "@/store/useAppStore";

const MODEL_PRESETS: Record<Provider, string[]> = {
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-1"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  openai: ["gpt-4o", "gpt-4o-mini"],
};

const MODEL_HINT: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-5",
  deepseek: "deepseek-v4-flash",
  openai: "gpt-4o-mini",
};

const KEY_HINT: Record<Provider, string> = {
  anthropic: "sk-ant-…",
  deepseek: "sk-…",
  openai: "sk-…",
};

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);

  const [provider, setProvider] = useState<Provider>(settings.provider);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState(settings.model);

  useEffect(() => {
    if (open) {
      setProvider(settings.provider);
      setApiKey(settings.apiKey);
      setModel(settings.model);
    }
  }, [open, settings]);

  const save = () => {
    setSettings({ provider, apiKey: apiKey.trim(), model: model.trim() });
    onOpenChange(false);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>
            填入你的 API Key —— 仅保存在本地浏览器，随请求直发到模型，不经第三方存储。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <Field label="模型提供商">
            <Select
              onValueChange={(v) => setProvider(v as Provider)}
              value={provider}
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

          <Field label="API Key">
            <Input
              autoComplete="off"
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={KEY_HINT[provider]}
              type="password"
              value={apiKey}
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
                <button
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs transition-colors",
                    model === mm
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                  key={mm}
                  onClick={() => setModel(mm)}
                  type="button"
                >
                  {mm}
                </button>
              ))}
            </div>
          </Field>

          <p className="text-xs text-muted-foreground">
            获取 Key：Anthropic → console.anthropic.com ；DeepSeek → platform.deepseek.com ；OpenAI → platform.openai.com
          </p>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            取消
          </Button>
          <Button disabled={!apiKey.trim()} onClick={save}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
