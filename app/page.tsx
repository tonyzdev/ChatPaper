"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { FloatingChat } from "@/components/chat/FloatingChat";
import { PdfSidebar } from "@/components/pdf/PdfSidebar";
import { useAppStore } from "@/store/useAppStore";

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
  const colorMode = useAppStore((s) => s.pdfColorMode);
  const chatOpen = useAppStore((s) => s.chatOpen);

  // 颜色模式应用为全局主题：dark→shadcn 深色；sepia→护眼绿。chat、引用浮钮等所有组件随之变化
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("dark", colorMode === "dark");
    if (colorMode === "sepia") {
      el.setAttribute("data-theme", "sepia");
    } else {
      el.removeAttribute("data-theme");
    }
  }, [colorMode]);

  return (
    <div className="h-full w-full overflow-hidden bg-muted/20 p-4">
      <div className="relative h-full min-w-0">
        {chatOpen ? (
          <PanelGroup
            autoSaveId="chatpaper-layout"
            className="h-full min-w-0"
            direction="horizontal"
          >
            <Panel className="min-w-0" defaultSize={70} minSize={42}>
              <div className="flex h-full min-w-0 overflow-hidden rounded-3xl border bg-background shadow-sm">
                <PdfSidebar />
                <div className="min-w-0 flex-1">
                  <PdfReader />
                </div>
              </div>
            </Panel>

            <PanelResizeHandle className="group relative flex w-4 shrink-0 cursor-col-resize items-center justify-center text-border transition-colors hover:text-primary/50 data-[resize-handle-state=drag]:text-primary">
              <span className="absolute inset-y-0 w-4" />
              <span className="h-24 w-px rounded-full bg-current" />
            </PanelResizeHandle>

            <Panel className="min-w-0" defaultSize={30} maxSize={42} minSize={24}>
              <FloatingChat />
            </Panel>
          </PanelGroup>
        ) : (
          <div className="relative flex h-full min-w-0">
            <div className="flex min-w-0 flex-1 overflow-hidden rounded-3xl border bg-background shadow-sm">
              <PdfSidebar />
              <div className="min-w-0 flex-1">
                <PdfReader />
              </div>
            </div>
            <FloatingChat />
          </div>
        )}
      </div>
    </div>
  );
}
