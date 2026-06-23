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
    <div className="flex h-full w-full">
      {/* 多 PDF 文献栏（可折叠；无 PDF 时不渲染） */}
      <PdfSidebar />
      {/* PDF 铺满整个内容区作底层，聊天悬浮其上（FloatingChat 相对此容器定位） */}
      <div className="relative min-w-0 flex-1">
        <PdfReader />
        <FloatingChat />
      </div>
    </div>
  );
}
