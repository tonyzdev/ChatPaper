"use client";

import {
  Check,
  FileSearch,
  FileText,
  FileUp,
  Highlighter,
  Leaf,
  Moon,
  Quote,
  Sun,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { loadAnnotations } from "@/lib/annotationStore";
import { type PageRect, toPageRects } from "@/lib/annotations";
import { extractPdfText } from "@/lib/pdfText";
import type { Annotation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { type PdfTextStatus, useAppStore } from "@/store/useAppStore";

// pdf.js worker：本地打包（new URL 静态资源引用，Turbopack/webpack 都会发射该文件），
// 版本与 react-pdf 内置 pdfjs 永远一致，且不依赖 unpkg CDN（国内访问不稳、挂了阅读器全废）
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface Popover {
  text: string;
  page: number;
  top: number;
  left: number;
  /** 选区相对页面的百分比矩形，用于保存高亮 */
  rects: PageRect[];
}

/** 点击已有高亮后弹出的编辑框状态（相对滚动容器定位） */
interface ActiveAnno {
  id: string;
  note: string;
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
  const pdfJump = useAppStore((s) => s.pdfJump);
  const pdfId = useAppStore((s) => s.pdfId);
  const annotations = useAppStore((s) => s.annotations);
  const setAnnotations = useAppStore((s) => s.setAnnotations);
  const addAnnotation = useAppStore((s) => s.addAnnotation);
  const removeAnnotation = useAppStore((s) => s.removeAnnotation);
  const updateAnnotation = useAppStore((s) => s.updateAnnotation);
  const [activeAnno, setActiveAnno] = useState<ActiveAnno | null>(null);

  // 切换 / 打开 PDF 时载入该 PDF 的高亮（pdfId 变化即重载；无 PDF 清空）
  useEffect(() => {
    if (!pdfId) {
      setAnnotations([]);
      return;
    }
    let alive = true;
    void loadAnnotations(pdfId).then((items) => {
      if (alive) setAnnotations(items);
    });
    return () => {
      alive = false;
    };
  }, [pdfId, setAnnotations]);

  const [scale, setScale] = useState(1.2);
  const pinchZoom = useAppStore((s) => s.pdfPinchZoom);
  const setPinchZoom = useAppStore((s) => s.setPdfPinchZoom);
  const colorMode = useAppStore((s) => s.pdfColorMode);
  const setColorMode = useAppStore((s) => s.setPdfColorMode);
  const autoParseFullText = useAppStore((s) => s.settings.autoParseFullText);
  const pdfTextStatus = useAppStore((s) => s.pdfTextStatus);
  const pdfTextProgress = useAppStore((s) => s.pdfTextProgress);
  const setPdfFullText = useAppStore((s) => s.setPdfFullText);
  const setPdfTextStatus = useAppStore((s) => s.setPdfTextStatus);
  const setPdfTextMode = useAppStore((s) => s.setPdfTextMode);
  const pdfTextMode = useAppStore((s) => s.pdfTextMode);
  const ocrEnabled = useAppStore(
    (s) => s.settings.ocr.enabled && s.settings.ocr.apiKey.trim().length > 0,
  );
  const [popover, setPopover] = useState<Popover | null>(null);
  // 每页 scale=1 的基准尺寸，用于懒渲染占位（页面未渲染时也保持正确高度，滚动条不跳）
  const [pageSizes, setPageSizes] = useState<{ width: number; height: number }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  // 点击 AI 回答里的页码引用 → 滚动到该页并高亮闪烁定位。懒渲染下占位 div
  // 始终在 DOM（带 data-page-number），滚动进视口会触发该页真正渲染。
  useEffect(() => {
    if (!pdfJump) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-page-number="${pdfJump.page}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("cp-page-flash");
    const t = setTimeout(() => el.classList.remove("cp-page-flash"), 1600);
    return () => clearTimeout(t);
  }, [pdfJump]);

  const collectPageSizes = useCallback(async (pdf: PDFDocumentProxy) => {
    const sizes: { width: number; height: number }[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      sizes.push({ width: vp.width, height: vp.height });
    }
    if (docRef.current === pdf) setPageSizes(sizes); // 期间换了文件则丢弃
  }, []);

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
      if (!file || file.type !== "application/pdf") return;
      const st = useAppStore.getState();
      const conv = st.conversations.find((c) => c.id === st.currentId);
      // 当前对话已经在聊、且已绑了 PDF：让用户选「开新对话」还是「加到当前」
      if ((conv?.messages.length ?? 0) > 0 && st.pdfId) {
        st.setPendingPdf(file);
      } else {
        openPdf(file);
      }
    },
    [openPdf],
  );

  const runParse = useCallback(
    async (pdf: PDFDocumentProxy) => {
      if (useAppStore.getState().pdfTextStatus === "parsing") return;
      setPdfTextMode("text");
      setPdfTextStatus("parsing", 0);
      try {
        const text = await extractPdfText(pdf, (done) =>
          setPdfTextStatus("parsing", done),
        );
        // 文本层近乎为空 → 多半是扫描件：提示用 OCR（不自动跑，避免意外消耗）
        if (text.replace(/\s/g, "").length < pdf.numPages * 10) {
          setPdfTextStatus("scanned");
        } else {
          setPdfFullText(text);
        }
      } catch {
        setPdfTextStatus("error");
      }
    },
    [setPdfTextStatus, setPdfFullText, setPdfTextMode],
  );

  // 扫描件：逐页渲染成图片，交给 DeepSeek-OCR 识别，结果走同一套全文上下文管线。
  // 3 路并发（再高容易撞 OCR 服务的速率限制），结果按页序写回 pages 数组
  const ocrPdf = useCallback(
    async (pdf: PDFDocumentProxy) => {
      const ocr = useAppStore.getState().settings.ocr;
      if (!ocr.enabled || !ocr.apiKey.trim()) return;
      if (useAppStore.getState().pdfTextStatus === "parsing") return;
      setPdfTextMode("ocr");
      setPdfTextStatus("parsing", 0);
      try {
        const total = pdf.numPages;
        const pages: string[] = new Array(total).fill("");
        let nextPage = 1;
        let done = 0;
        const worker = async () => {
          while (true) {
            const pageNum = nextPage++;
            if (pageNum > total) return;
            const imageUrl = await renderPageToImage(pdf, pageNum);
            const res = await fetch("/api/ocr", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageUrl, ocr }),
            });
            const data = (await res.json()) as {
              ok: boolean;
              text?: string;
              error?: string;
            };
            if (!data.ok) throw new Error(data.error || "OCR 失败");
            pages[pageNum - 1] = (data.text || "").trim();
            done++;
            setPdfTextStatus("parsing", done);
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(3, total) }, () => worker()),
        );
        setPdfFullText(
          pages
            .map((p, i) => `[第 ${i + 1} 页]\n${p}`)
            .join("\n\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim(),
        );
      } catch {
        setPdfTextStatus("error");
      }
    },
    [setPdfTextStatus, setPdfFullText, setPdfTextMode],
  );

  // 设置里开启「自动解析全文」后，若已加载 PDF 但还没解析，补跑一次
  useEffect(() => {
    if (
      autoParseFullText &&
      docRef.current &&
      useAppStore.getState().pdfTextStatus === "idle"
    ) {
      void runParse(docRef.current);
    }
  }, [autoParseFullText, runParse]);

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
    // 选区相对所在页的百分比矩形（用于保存高亮，与缩放无关）
    const pageEl = container.querySelector<HTMLElement>(
      `[data-page-number="${page}"]`,
    );
    const rects = pageEl
      ? toPageRects(
          Array.from(range.getClientRects()),
          pageEl.getBoundingClientRect(),
        )
      : [];
    setPopover({
      text,
      page,
      top: r.top - c.top + container.scrollTop - 8,
      left: r.left - c.left + container.scrollLeft + r.width / 2,
      rects,
    });
  }, [mode, setPendingTranslate]);

  const confirmCite = useCallback(() => {
    if (!popover) return;
    addCitation({ text: popover.text, page: popover.page, source: fileName ?? "PDF" });
    window.getSelection()?.removeAllRanges();
    setPopover(null);
  }, [popover, addCitation, fileName]);

  const confirmHighlight = useCallback(() => {
    if (!popover || popover.rects.length === 0 || !pdfId) return;
    addAnnotation({
      pdfId,
      page: popover.page,
      rects: popover.rects,
      text: popover.text,
    });
    window.getSelection()?.removeAllRanges();
    setPopover(null);
  }, [popover, addAnnotation, pdfId]);

  // 点击已有高亮块 → 在点击处弹出编辑框（批注 / 删除）
  const handleActivateAnno = useCallback(
    (a: Annotation, clientX: number, clientY: number) => {
      const container = scrollRef.current;
      if (!container) return;
      const c = container.getBoundingClientRect();
      setActiveAnno({
        id: a.id,
        note: a.note ?? "",
        top: clientY - c.top + container.scrollTop,
        left: clientX - c.left + container.scrollLeft,
      });
    },
    [],
  );

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
        {numPages > 0 ? (
          <FullTextButton
            mode={pdfTextMode}
            ocrEnabled={ocrEnabled}
            onClear={() => setPdfFullText(null)}
            onOcr={() => {
              if (docRef.current) void ocrPdf(docRef.current);
            }}
            onParse={() => {
              if (docRef.current) void runParse(docRef.current);
            }}
            progress={pdfTextProgress}
            status={pdfTextStatus}
            total={numPages}
          />
        ) : null}
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
        {/* 颜色模式 filter 只作用于 .react-pdf__Page（globals.css 按 data-pdf-theme
            选择器下沉到页面渲染层），高亮层 / 页码闪烁等覆盖物不跟着偏色 */}
        <div data-pdf-theme={colorMode === "light" ? undefined : colorMode}>
          <Document
            className="flex flex-col items-center gap-4"
            error={<Center>无法加载该 PDF 文件</Center>}
            file={fileUrl}
            loading={<Center>正在加载 PDF…</Center>}
            onLoadSuccess={(pdf) => {
              setNumPages(pdf.numPages);
              docRef.current = pdf;
              setPageSizes([]);
              void collectPageSizes(pdf);
              if (useAppStore.getState().settings.autoParseFullText) {
                void runParse(pdf);
              }
            }}
          >
            {Array.from({ length: numPages }, (_, i) => (
              <LazyPage
                annotations={annotations.filter((a) => a.page === i + 1)}
                baseSize={pageSizes[i] ?? pageSizes[0]}
                key={i}
                onActivate={handleActivateAnno}
                pageNumber={i + 1}
                rootRef={scrollRef}
                scale={scale}
              />
            ))}
          </Document>
        </div>

        {popover && (
          <div
            className="absolute z-20 flex -translate-x-1/2 -translate-y-full gap-1"
            style={{ top: popover.top, left: popover.left }}
          >
            <Button
              className="shadow-lg"
              onClick={confirmCite}
              onMouseDown={(e) => e.preventDefault()}
              size="sm"
            >
              <Quote className="size-3.5" />
              引用
            </Button>
            {popover.rects.length > 0 ? (
              <Button
                className="shadow-lg"
                onClick={confirmHighlight}
                onMouseDown={(e) => e.preventDefault()}
                size="sm"
              >
                <Highlighter className="size-3.5" />
                高亮
              </Button>
            ) : null}
          </div>
        )}

        {activeAnno && (
          <div
            className="absolute z-30 w-56 -translate-x-1/2 translate-y-2 rounded-lg border bg-background p-2 shadow-xl"
            style={{ top: activeAnno.top, left: activeAnno.left }}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-muted-foreground text-xs">高亮批注</span>
              <button
                aria-label="删除高亮"
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  removeAnnotation(activeAnno.id);
                  setActiveAnno(null);
                }}
                title="删除这条高亮"
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            <textarea
              className="h-16 w-full resize-none rounded border bg-transparent p-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
              onChange={(e) =>
                setActiveAnno({ ...activeAnno, note: e.target.value })
              }
              placeholder="加批注…"
              value={activeAnno.note}
            />
            <div className="mt-1.5 flex justify-end gap-1">
              <Button
                onClick={() => setActiveAnno(null)}
                size="sm"
                variant="ghost"
              >
                取消
              </Button>
              <Button
                onClick={() => {
                  updateAnnotation(activeAnno.id, { note: activeAnno.note });
                  setActiveAnno(null);
                }}
                size="sm"
              >
                保存
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 懒渲染单页：只有滚到视口附近（上下约 1.5 屏）才真正渲染 pdf.js canvas，
 * 滚远后卸载回收内存 —— 大 PDF（百页级）不再一次性渲染所有页面。
 * 占位 div 按真实页面尺寸 × scale 撑高，滚动条位置稳定；
 * data-page-number 保留在外层 wrapper 上，划选引用的页码定位不受影响。
 */
function LazyPage({
  pageNumber,
  scale,
  baseSize,
  rootRef,
  annotations,
  onActivate,
}: {
  pageNumber: number;
  scale: number;
  baseSize?: { width: number; height: number };
  rootRef: React.RefObject<HTMLDivElement | null>;
  annotations: Annotation[];
  onActivate: (a: Annotation, clientX: number, clientY: number) => void;
}) {
  // 首屏前两页直接渲染，避免 observer 首次回调前的空白
  const [visible, setVisible] = useState(pageNumber <= 2);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { root: rootRef.current, rootMargin: "150% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootRef]);

  // 尺寸未收集到时按 US Letter 比例估一个，避免占位高度为 0 导致全部页“可见”
  const w = Math.ceil((baseSize?.width ?? 612) * scale);
  const h = Math.ceil((baseSize?.height ?? 792) * scale);
  const placeholder = <div style={{ width: w, height: h }} />;

  return (
    <div className="relative shadow-md" data-page-number={pageNumber} ref={ref}>
      {visible ? (
        <Page
          loading={placeholder}
          pageNumber={pageNumber}
          renderAnnotationLayer={false}
          renderTextLayer
          scale={scale}
        />
      ) : (
        placeholder
      )}
      {annotations.length > 0 ? (
        <div className="pointer-events-none absolute inset-0">
          {annotations.flatMap((a) =>
            a.rects.map((r, idx) => (
              <button
                className="pointer-events-auto absolute bg-yellow-300/40 transition-colors hover:bg-yellow-300/60"
                key={`${a.id}-${idx}`}
                onClick={(e) => onActivate(a, e.clientX, e.clientY)}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                }}
                title={a.note || a.text}
                type="button"
              />
            )),
          )}
        </div>
      ) : null}
    </div>
  );
}

function Dropzone({ onPick }: { onPick: (f?: File | null) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <div className="flex h-full flex-col items-center justify-center bg-muted/40 p-8">
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

async function renderPageToImage(
  pdf: PDFDocumentProxy,
  pageNum: number,
  targetWidth = 1500,
): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: targetWidth / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context 不可用");
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas.toDataURL("image/jpeg", 0.85);
}

function FullTextButton({
  status,
  mode,
  progress,
  total,
  ocrEnabled,
  onParse,
  onOcr,
  onClear,
}: {
  status: PdfTextStatus;
  mode: "text" | "ocr";
  progress: number;
  total: number;
  ocrEnabled: boolean;
  onParse: () => void;
  onOcr: () => void;
  onClear: () => void;
}) {
  if (status === "parsing") {
    return (
      <Button disabled size="sm" variant="outline">
        <Spinner className="size-3.5" />
        {mode === "ocr" ? "OCR 中" : "解析中"} {progress}/{total}
      </Button>
    );
  }
  if (status === "ready") {
    return (
      <Button
        onClick={onClear}
        size="sm"
        title="已作为对话上下文，点击移除"
        variant="secondary"
      >
        <Check className="size-3.5 text-green-600" />
        {mode === "ocr" ? "OCR 全文已就绪" : "全文已解析"}
      </Button>
    );
  }
  if (status === "scanned") {
    return ocrEnabled ? (
      <Button
        onClick={onOcr}
        size="sm"
        title="该 PDF 无文本层，用 DeepSeek-OCR 逐页识别"
        variant="outline"
      >
        <FileSearch className="size-3.5" />
        OCR 解析
      </Button>
    ) : (
      <Button
        onClick={onParse}
        size="sm"
        title="疑似扫描件（无文本层）。在 设置→文档 开启 OCR 后可识别"
        variant="outline"
      >
        <FileSearch className="size-3.5" />
        疑似扫描件
      </Button>
    );
  }
  return (
    <Button
      onClick={onParse}
      size="sm"
      title="解析整篇 PDF 文本，作为对话上下文发送给 AI"
      variant="outline"
    >
      <FileText className="size-3.5" />
      {status === "error" ? "解析失败 · 重试" : "解析全文"}
    </Button>
  );
}
