"use client";

import { MessageSquare } from "lucide-react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

/**
 * 右侧对话区：展开时占据独立侧栏，避免压住 PDF；收起后缩成右下角一个悬浮圆钮。
 */
export function FloatingChat() {
  const open = useAppStore((s) => s.chatOpen);
  const setChatOpen = useAppStore((s) => s.setChatOpen);

  if (open) {
    return (
      <div
        className={cn(
          "flex h-full w-full min-w-0 flex-col overflow-hidden rounded-3xl",
          "border border-border/60 bg-background/88 shadow-2xl shadow-black/8 backdrop-blur-xl",
        )}
      >
        <ChatPanel onCollapse={() => setChatOpen(false)} />
      </div>
    );
  }

  return (
    <button
      aria-label="展开对话"
      className={cn(
        "absolute right-0 bottom-0 z-30 flex size-14 items-center justify-center",
        "rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25",
        "transition-all duration-300 ease-out hover:scale-105 active:scale-95",
      )}
      onClick={() => setChatOpen(true)}
      type="button"
    >
      <MessageSquare className="size-6" />
    </button>
  );
}
