"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// --- 图标(沿用 21st.dev 原组件的视觉) ---
const PlusIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg fill="none" height="24" viewBox="0 0 24 24" width="24" {...props}>
    <path d="M12 5V19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    <path d="M5 12H19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
  </svg>
);
const SendIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg fill="none" height="24" viewBox="0 0 24 24" width="24" {...props}>
    <path d="M12 5.25L12 18.75" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    <path d="M18.75 12L12 5.25L5.25 12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
  </svg>
);
const StopIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg fill="currentColor" height="24" viewBox="0 0 24 24" width="24" {...props}>
    <rect height="11" rx="2.5" width="11" x="6.5" y="6.5" />
  </svg>
);

export type PromptBoxStatus = "ready" | "submitted" | "streaming" | "error";

export interface PromptBoxProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  status?: PromptBoxStatus;
  onStop?: () => void;
  /** 传入则显示「+」附件按钮 */
  onAttachFiles?: (files: FileList) => void;
  placeholder?: string;
  /** 输入框上方插槽（用于引用 chips 等） */
  header?: React.ReactNode;
  className?: string;
}

/**
 * 基于 21st.dev「chatgpt-prompt-input」的视觉，改造为受控、可接 useChat 的输入框：
 * - 受控 value / onValueChange / onSubmit
 * - status + onStop：生成中发送键变停止键
 * - header 插槽放引用 chips
 * - 支持中文输入法（compose 中不触发发送）、Enter 发送 / Shift+Enter 换行
 */
export function PromptBox({
  value,
  onValueChange,
  onSubmit,
  status = "ready",
  onStop,
  onAttachFiles,
  placeholder = "问点什么…",
  header,
  className,
}: PromptBoxProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const isGenerating = status === "submitted" || status === "streaming";
  const hasValue = value.trim().length > 0;

  // 自动增高(上限 200px,超出内部滚动)
  React.useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }
  }, [value]);

  const submit = () => {
    if (isGenerating) {
      onStop?.();
      return;
    }
    if (hasValue) onSubmit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  // 支持 Ctrl/Cmd+V 直接粘贴图片/文件到输入框
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onAttachFiles) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      onAttachFiles(dt.files);
    }
  };

  return (
    // biome-ignore lint/a11y: 容器点击聚焦输入框是输入框的常规交互
    <div
      className={cn(
        "flex cursor-text flex-col rounded-[28px] border bg-background p-2 shadow-sm transition-all focus-within:border-ring/60 focus-within:shadow-md",
        className,
      )}
      onClick={() => textareaRef.current?.focus()}
    >
      {header ? <div className="px-2 pt-1.5 pb-1">{header}</div> : null}

      {onAttachFiles ? (
        <input
          accept="image/*,application/pdf"
          className="hidden"
          multiple
          onChange={(e) => {
            if (e.target.files?.length) onAttachFiles(e.target.files);
            e.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />
      ) : null}

      <textarea
        className="w-full resize-none overflow-y-auto border-0 bg-transparent p-3 text-[0.95rem] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:ring-0 focus-visible:outline-none"
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={value}
      />

      <div className="mt-0.5 flex items-center gap-2 px-2 pb-0.5">
        {onAttachFiles ? (
          <button
            aria-label="添加图片或文件"
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <PlusIcon className="size-5" />
          </button>
        ) : null}

        <button
          aria-label={isGenerating ? "停止" : "发送"}
          className="ml-auto flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-primary/40"
          disabled={!hasValue && !isGenerating}
          onClick={submit}
          type="button"
        >
          {isGenerating ? <StopIcon className="size-4" /> : <SendIcon className="size-5" />}
        </button>
      </div>
    </div>
  );
}

PromptBox.displayName = "PromptBox";
