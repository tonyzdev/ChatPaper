"use client";

import { FileText, PanelLeftClose, PanelLeftOpen, Plus, X } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { currentProject, currentProjectPdfs, useAppStore } from "@/store/useAppStore";

export function PdfSidebar() {
  const project = useAppStore((s) => currentProject(s));
  const pdfs = useAppStore((s) => currentProjectPdfs(s));
  const pdfId = useAppStore((s) => s.pdfId);
  const open = useAppStore((s) => s.pdfSidebarOpen);
  const setOpen = useAppStore((s) => s.setPdfSidebarOpen);
  const activatePdf = useAppStore((s) => s.activatePdf);
  const removePdf = useAppStore((s) => s.removePdf);
  const openPdf = useAppStore((s) => s.openPdf);
  const fileRef = useRef<HTMLInputElement>(null);

  if (pdfs.length === 0) return null;

  return (
    <div
      className={cn(
        "flex h-full shrink-0 flex-col border-r bg-muted/30 transition-[width] duration-150",
        open ? "w-56" : "w-11",
      )}
    >
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b px-1.5",
          open ? "justify-between gap-2" : "justify-center",
        )}
      >
        {open ? (
          <div className="min-w-0 pl-1.5">
            <div className="truncate font-medium text-xs" title={project?.name}>
              {project?.name ?? "当前项目"}
            </div>
            <div className="text-[11px] text-muted-foreground">文献（{pdfs.length}）</div>
          </div>
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
        {pdfs.map((pdf) =>
          open ? (
            <div
              className={cn(
                "group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors",
                pdf.id === pdfId
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              key={pdf.id}
              onClick={() => void activatePdf(pdf.id)}
              title={pdf.name}
            >
              <FileText className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-xs">{pdf.name}</span>
              <button
                aria-label={`移除 ${pdf.name}`}
                className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-background hover:text-destructive group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  removePdf(pdf.id);
                }}
                type="button"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              aria-label={pdf.name}
              className={cn(
                "flex items-center justify-center rounded-md py-2 transition-colors",
                pdf.id === pdfId
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              key={pdf.id}
              onClick={() => void activatePdf(pdf.id)}
              title={pdf.name}
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
          title={project ? `添加 PDF 到项目「${project.name}」` : "添加 PDF"}
          variant="ghost"
        >
          <Plus className="size-4" />
          {open ? <span className="text-xs">添加 PDF</span> : null}
        </Button>
        <input
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && file.type === "application/pdf") openPdf(file);
            e.target.value = "";
          }}
          ref={fileRef}
          type="file"
        />
      </div>
    </div>
  );
}
