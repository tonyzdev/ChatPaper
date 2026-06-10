"use client";

import { FileText, PanelLeftClose, PanelLeftOpen, Plus, X } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

/**
 * 多 PDF 侧边栏：展示当前会话打开的全部 PDF，点击切换正在阅读的那篇。
 * 可折叠：展开是带文件名的列表，折叠只剩图标窄条。没有 PDF 时不渲染。
 */
export function PdfSidebar() {
  const openPdfs = useAppStore((s) => s.openPdfs);
  const pdfId = useAppStore((s) => s.pdfId);
  const open = useAppStore((s) => s.pdfSidebarOpen);
  const setOpen = useAppStore((s) => s.setPdfSidebarOpen);
  const activatePdf = useAppStore((s) => s.activatePdf);
  const removePdf = useAppStore((s) => s.removePdf);
  const openPdf = useAppStore((s) => s.openPdf);
  const fileRef = useRef<HTMLInputElement>(null);

  if (openPdfs.length === 0) return null;

  return (
    <div
      className={cn(
        "flex h-full shrink-0 flex-col border-r bg-muted/30 transition-[width] duration-150",
        open ? "w-52" : "w-11",
      )}
    >
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b px-1.5",
          open ? "justify-between" : "justify-center",
        )}
      >
        {open ? (
          <span className="pl-1.5 font-medium text-muted-foreground text-xs">
            文献（{openPdfs.length}）
          </span>
        ) : null}
        <Button
          aria-label={open ? "折叠文献栏" : "展开文献栏"}
          onClick={() => setOpen(!open)}
          size="icon-sm"
          variant="ghost"
        >
          {open ? (
            <PanelLeftClose className="size-4" />
          ) : (
            <PanelLeftOpen className="size-4" />
          )}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
        {openPdfs.map((p) =>
          open ? (
            <div
              className={cn(
                "group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors",
                p.id === pdfId
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              key={p.id}
              onClick={() => void activatePdf(p.id)}
              title={p.name}
            >
              <FileText className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-xs">{p.name}</span>
              <button
                aria-label={`移除 ${p.name}`}
                className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-background hover:text-destructive group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  removePdf(p.id);
                }}
                type="button"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              aria-label={p.name}
              className={cn(
                "flex items-center justify-center rounded-md py-2 transition-colors",
                p.id === pdfId
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              key={p.id}
              onClick={() => void activatePdf(p.id)}
              title={p.name}
              type="button"
            >
              <FileText className="size-4" />
            </button>
          ),
        )}
      </div>

      <div className="shrink-0 border-t p-1.5">
        <Button
          className={cn("w-full", open ? "justify-start gap-1.5" : "px-0")}
          onClick={() => fileRef.current?.click()}
          size="sm"
          title="添加 PDF 到当前对话"
          variant="ghost"
        >
          <Plus className="size-4" />
          {open ? <span className="text-xs">添加 PDF</span> : null}
        </Button>
        <input
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            // 从侧边栏添加 = 明确加入当前对话，不走「开新对话」确认弹窗
            if (f && f.type === "application/pdf") openPdf(f);
            e.target.value = "";
          }}
          ref={fileRef}
          type="file"
        />
      </div>
    </div>
  );
}
