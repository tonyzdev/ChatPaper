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
import { type Provider, useAppStore } from "@/store/useAppStore";

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

  // 每次打开时同步为当前已保存的值
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
              placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
              type="password"
              value={apiKey}
            />
          </Field>

          <Field label="模型（可选，留空用默认）">
            <Input
              autoComplete="off"
              onChange={(e) => setModel(e.target.value)}
              placeholder={
                provider === "anthropic"
                  ? "claude-sonnet-4-5"
                  : provider === "deepseek"
                    ? "deepseek-chat"
                    : "gpt-4o-mini"
              }
              value={model}
            />
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
