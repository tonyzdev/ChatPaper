"use client";

import { MessageSquare } from "lucide-react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

/**
 * 悬浮聊天岛：PDF 铺满底层，聊天作为浮在右侧的毛玻璃圆角卡片；
 * 收起后缩成右下角一个悬浮圆钮。用 absolute 相对内容区定位（不盖左侧文献栏），
 * 展开/收起都常驻渲染，用 opacity + translate + pointer-events 做过渡。
 */
export function FloatingChat() {
  const open = useAppStore((s) => s.chatOpen);
  const setChatOpen = useAppStore((s) => s.setChatOpen);

  return (
    <>
      <div
        className={cn(
          "absolute top-4 right-4 bottom-4 z-30 w-[min(28rem,calc(100%-2rem))]",
          "flex flex-col overflow-hidden rounded-2xl border border-border/60",
          "bg-background/80 shadow-2xl shadow-black/10 backdrop-blur-xl",
          "transition-all duration-300 ease-out",
          open
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-3 opacity-0",
        )}
      >
        <ChatPanel onCollapse={() => setChatOpen(false)} />
      </div>

      {/* 收起后的悬浮圆钮 */}
      <button
        aria-label="展开对话"
        className={cn(
          "absolute right-6 bottom-6 z-30 flex size-14 items-center justify-center",
          "rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25",
          "transition-all duration-300 ease-out hover:scale-105 active:scale-95",
          open
            ? "pointer-events-none translate-y-2 scale-90 opacity-0"
            : "pointer-events-auto translate-y-0 scale-100 opacity-100",
        )}
        onClick={() => setChatOpen(true)}
        type="button"
      >
        <MessageSquare className="size-6" />
      </button>
    </>
  );
}
