"use client";

import { FileUp, Leaf, Moon, Quote, Sun, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

// pdf.js worker：用 CDN，且版本与 react-pdf 内置 pdfjs 对齐，避免 worker 版本错配
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Popover {
  text: string;
  page: number;
  top: number;
  left: number;
}

export function PdfReader() {
  const fileUrl = useAppStore((s) => s.fileUrl);
  const fileName = useAppStore((s) => s.fileName);
  const numPages = useAppStore((s) => s.numPages);
  const openPdf = useAppStore((s) => s.openPdf);
  const closePdf = useAppStore((s) => s.closePdf);
  const setNumPages = useAppStore((s) => s.setNumPages);
  const addCitation = useAppStore((s) => s.addCitation);
  const mode = useAppStore((s) => s.mode);
  const setPendingTranslate = useAppStore((s) => s.setPendingTranslate);

  const [scale, setScale] = useState(1.2);
  const pinchZoom = useAppStore((s) => s.pdfPinchZoom);
  const setPinchZoom = useAppStore((s) => s.setPdfPinchZoom);
  const colorMode = useAppStore((s) => s.pdfColorMode);
  const setColorMode = useAppStore((s) => s.setPdfColorMode);
  const [popover, setPopover] = useState<Popover | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 触控板双指捏合 = 带 ctrlKey 的 wheel。始终拦截以防整页被缩放；
  // 开关开启时把它转成 PDF 缩放，关闭时双指照常滚动。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (!pinchZoom) return;
      setScale((s) =>
        Math.min(3, Math.max(0.5, +(s - e.deltaY * 0.01).toFixed(2))),
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pinchZoom, fileUrl]);

  const pickFile = useCallback(
    (file?: File | null) => {
      if (file && file.type === "application/pdf") openPdf(file);
    },
    [openPdf],
  );

  // 划选 → 计算引用文本 / 页码 / 浮钮位置
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const container = scrollRef.current;
    if (!sel || sel.isCollapsed || !container) {
      setPopover(null);
      return;
    }
    const text = sel.toString().trim();
    const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (!text || !range || !container.contains(range.commonAncestorContainer)) {
      setPopover(null);
      return;
    }
    // 翻译模式：划选即翻译，不弹引用浮钮
    if (mode === "translate") {
      setPendingTranslate(text);
      sel.removeAllRanges();
      setPopover(null);
      return;
    }
    let node: Node | null = range.startContainer;
    let page = 1;
    while (node && node !== container) {
      if (node instanceof HTMLElement && node.dataset.pageNumber) {
        page = Number(node.dataset.pageNumber);
        break;
      }
      node = node.parentNode;
    }
    const r = range.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    setPopover({
      text,
      page,
      top: r.top - c.top + container.scrollTop - 8,
      left: r.left - c.left + container.scrollLeft + r.width / 2,
    });
  }, [mode, setPendingTranslate]);

  const confirmCite = useCallback(() => {
    if (!popover) return;
    addCitation({ text: popover.text, page: popover.page, source: fileName ?? "PDF" });
    window.getSelection()?.removeAllRanges();
    setPopover(null);
  }, [popover, addCitation, fileName]);

  if (!fileUrl) {
    return <Dropzone onPick={pickFile} />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-muted/40">
      {/* 工具栏 */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
        <span className="truncate text-sm font-medium" title={fileName ?? undefined}>
          {fileName}
        </span>
        {numPages > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">{numPages} 页</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <label className="flex cursor-pointer select-none items-center gap-1.5" title="开启后用触控板双指捏合/张开缩放 PDF">
            <Switch
              checked={pinchZoom}
              onCheckedChange={(c) => setPinchZoom(c)}
              size="sm"
            />
            <span className="text-xs text-muted-foreground">双指缩放</span>
          </label>
          <div className="flex items-center gap-0.5">
            <Button
              aria-label="颜色模式"
              onClick={() =>
                setColorMode(
                  colorMode === "light"
                    ? "sepia"
                    : colorMode === "sepia"
                      ? "dark"
                      : "light",
                )
              }
              size="icon-sm"
              title="颜色模式：日间 / 护眼 / 夜间"
              variant="ghost"
            >
              {colorMode === "light" ? (
                <Sun className="size-4" />
              ) : colorMode === "sepia" ? (
                <Leaf className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>
            <Button
              aria-label="缩小"
              onClick={() => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(2)))}
              size="icon-sm"
              variant="ghost"
            >
              <ZoomOut className="size-4" />
            </Button>
            <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(scale * 100)}%
            </span>
            <Button
              aria-label="放大"
              onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))}
              size="icon-sm"
              variant="ghost"
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button aria-label="关闭 PDF" onClick={closePdf} size="icon-sm" variant="ghost">
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* 内部滚动区：只有这里滚动，整页外壳不动 */}
      <div
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain p-4"
        onMouseUp={handleMouseUp}
        ref={scrollRef}
        style={{
          backgroundColor:
            colorMode === "dark"
              ? "#1b1b1b"
              : colorMode === "sepia"
                ? "#dbe7d1"
                : undefined,
        }}
      >
        {/* 颜色模式：对整个 PDF（纸张+文字）应用 filter。夜间=反色，护眼=染绿 */}
        <div
          className="transition-[filter] duration-150"
          style={{
            filter:
              colorMode === "dark"
                ? "invert(0.92) hue-rotate(180deg)"
                : colorMode === "sepia"
                  ? "sepia(0.5) saturate(0.85) hue-rotate(35deg) brightness(0.98)"
                  : undefined,
          }}
        >
          <Document
            className="flex flex-col items-center gap-4"
            error={<Center>无法加载该 PDF 文件</Center>}
            file={fileUrl}
            loading={<Center>正在加载 PDF…</Center>}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          >
            {Array.from({ length: numPages }, (_, i) => (
              <div className="shadow-md" data-page-number={i + 1} key={i}>
                <Page
                  pageNumber={i + 1}
                  renderAnnotationLayer={false}
                  renderTextLayer
                  scale={scale}
                />
              </div>
            ))}
          </Document>
        </div>

        {popover && (
          <div
            className="absolute z-20 -translate-x-1/2 -translate-y-full"
            style={{ top: popover.top, left: popover.left }}
          >
            <Button
              className="shadow-lg"
              onClick={confirmCite}
              onMouseDown={(e) => e.preventDefault()}
              size="sm"
            >
              <Quote className="size-3.5" />
              引用到对话
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Dropzone({ onPick }: { onPick: (f?: File | null) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <div className="flex h-full flex-col items-center justify-center bg-muted/40 p-8">
      {/* oxlint-disable-next-line label-has-associated-control */}
      <label
        className={cn(
          "flex w-full max-w-md cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed bg-background p-12 text-center transition-colors",
          drag ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
        )}
        onDragLeave={() => setDrag(false)}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          onPick(e.dataTransfer.files?.[0]);
        }}
      >
        <FileUp className="size-9 text-muted-foreground" />
        <div className="text-sm font-medium">拖入 PDF，或点击选择文件</div>
        <div className="text-xs text-muted-foreground">文件仅在本地浏览器打开，不会上传服务器</div>
        <input
          accept="application/pdf"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0])}
          type="file"
        />
      </label>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
