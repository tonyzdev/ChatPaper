"use client";

import dynamic from "next/dynamic";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ChatPanel } from "@/components/chat/ChatPanel";

// PDF 阅读器纯浏览器渲染（pdf.js），关闭 SSR
const PdfReader = dynamic(
  () => import("@/components/pdf/PdfReader").then((m) => m.PdfReader),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        正在加载阅读器…
      </div>
    ),
  },
);

export default function Home() {
  return (
    <PanelGroup
      autoSaveId="chatpaper-layout"
      className="h-full w-full"
      direction="horizontal"
    >
      <Panel className="h-full" defaultSize={56} minSize={30}>
        <PdfReader />
      </Panel>

      <PanelResizeHandle className="group relative w-px bg-border transition-colors data-[resize-handle-state=drag]:bg-primary hover:bg-primary/50">
        {/* 加宽不可见的命中区域，拖拽更稳更好抓 */}
        <span className="absolute inset-y-0 -left-1.5 -right-1.5 block" />
      </PanelResizeHandle>

      <Panel className="h-full" defaultSize={44} minSize={26}>
        <ChatPanel />
      </Panel>
    </PanelGroup>
  );
}
