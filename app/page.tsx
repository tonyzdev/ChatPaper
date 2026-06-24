"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
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
      <div className="relative flex h-full min-w-0 gap-4">
        <div className="flex min-w-0 flex-1 overflow-hidden rounded-3xl border bg-background shadow-sm">
          <PdfSidebar />
          <div className="min-w-0 flex-1">
            <PdfReader />
          </div>
        </div>

        {chatOpen ? (
          <div className="flex min-w-[24rem] shrink-0 basis-[28rem] xl:max-w-[32rem]">
            <FloatingChat />
          </div>
        ) : null}

        {!chatOpen ? <FloatingChat /> : null}
      </div>
    </div>
  );
}
