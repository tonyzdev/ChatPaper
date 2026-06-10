"use client";

import {
  Check,
  Copy,
  Crop,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { loadAnnotations } from "@/lib/annotationStore";
import { type PageRect, toPageRects } from "@/lib/annotations";
import { extractPdfText } from "@/lib/pdfText";
import { matchSpans } from "@/lib/textMatch";
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
  const openPdfsCount = useAppStore((s) => s.openPdfs.length);
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
  const regionEngineReady = useAppStore(
    (s) =>
      (s.settings.ocr.enabled && s.settings.ocr.apiKey.trim().length > 0) ||
      (s.settings.vision.enabled && s.settings.vision.apiKey.trim().length > 0),
  );
  const [popover, setPopover] = useState<Popover | null>(null);
  // 框选识别：选区转图喂 OCR/视觉模型，产出 LaTeX/Markdown（公式、表格、图说明）
  const [regionMode, setRegionMode] = useState(false);
  const [regionDrag, setRegionDrag] = useState<{
    sx: number;
    sy: number;
    cx: number;
    cy: number;
  } | null>(null);
  const [regionResult, setRegionResult] = useState<{
    status: "loading" | "ok" | "error";
    page: number;
    text?: string;
    error?: string;
  } | null>(null);
  // 每页 scale=1 的基准尺寸，用于懒渲染占位（页面未渲染时也保持正确高度，滚动条不跳）
  const [pageSizes, setPageSizes] = useState<{ width: number; height: number }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  // 点击 AI 回答里的页码引用 → 滚动到该页；带原文片段时等文本层渲染好后
  // 在 span 里定位该句高亮（matchSpans），找不到或没有片段则整页闪烁。
  // 懒渲染下占位 div 始终在 DOM，滚动进视口触发该页真正渲染，故需轮询等待。
  useEffect(() => {
    if (!pdfJump) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-page-number="${pdfJump.page}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const flashed: HTMLElement[] = [];
    const after = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
      timers.push(t);
    };
    const flashPage = () => {
      el.classList.add("cp-page-flash");
      after(1600, () => el.classList.remove("cp-page-flash"));
    };

    const quote = pdfJump.quote;
    if (!quote) {
      flashPage();
    } else {
      let attempts = 0;
      const tryMatch = () => {
        const spans = Array.from(
          el.querySelectorAll<HTMLElement>(
            ".react-pdf__Page__textContent > span",
          ),
        );
        if (spans.length > 0) {
          const hits = matchSpans(
            spans.map((s) => s.textContent ?? ""),
            quote,
          );
          if (hits.length > 0) {
            spans[hits[0]].scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
            for (const i of hits) {
              spans[i].classList.add("cp-span-flash");
              flashed.push(spans[i]);
            }
            after(2600, () => {
              for (const s of flashed) s.classList.remove("cp-span-flash");
            });
          } else {
            flashPage(); // 文本层就绪但没匹配上（AI 改写了原文）→ 退回页级
          }
          return;
        }
        // 文本层还没渲染（懒渲染中）：最多等 12 × 250ms
        if (++attempts < 12) after(250, tryMatch);
        else flashPage();
      };
      tryMatch();
    }

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      el.classList.remove("cp-page-flash");
      for (const s of flashed) s.classList.remove("cp-span-flash");
    };
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
      // 多 PDF：解析中用户可能切到另一篇，切走后丢弃结果，避免全文串到别篇名下
      const startId = useAppStore.getState().pdfId;
      const stillActive = () => useAppStore.getState().pdfId === startId;
      setPdfTextMode("text");
      setPdfTextStatus("parsing", 0);
      try {
        const text = await extractPdfText(pdf, (done) => {
          if (stillActive()) setPdfTextStatus("parsing", done);
        });
        if (!stillActive()) return;
        // 文本层近乎为空 → 多半是扫描件：提示用 OCR（不自动跑，避免意外消耗）
        if (text.replace(/\s/g, "").length < pdf.numPages * 10) {
          setPdfTextStatus("scanned");
        } else {
          setPdfFullText(text);
        }
      } catch {
        if (stillActive()) setPdfTextStatus("error");
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
      const startId = useAppStore.getState().pdfId;
      const stillActive = () => useAppStore.getState().pdfId === startId;
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
            if (stillActive()) setPdfTextStatus("parsing", done);
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(3, total) }, () => worker()),
        );
        if (!stillActive()) return;
        setPdfFullText(
          pages
            .map((p, i) => `[第 ${i + 1} 页]\n${p}`)
            .join("\n\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim(),
        );
      } catch {
        if (stillActive()) setPdfTextStatus("error");
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

  // Esc 退出框选模式
  useEffect(() => {
    if (!regionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRegionMode(false);
        setRegionDrag(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [regionMode]);

  // 框选结束：定位所在页 → 选区转页内百分比 → 裁图 → 送 OCR / 视觉模型
  const finishRegion = useCallback(
    async (drag: { sx: number; sy: number; cx: number; cy: number }) => {
      setRegionMode(false);
      setRegionDrag(null);
      const container = scrollRef.current;
      const pdf = docRef.current;
      if (!container || !pdf) return;
      const left = Math.min(drag.sx, drag.cx);
      const top = Math.min(drag.sy, drag.cy);
      const right = Math.max(drag.sx, drag.cx);
      const bottom = Math.max(drag.sy, drag.cy);
      if (right - left < 8 || bottom - top < 8) return; // 误点

      // 命中相交面积最大的页
      let best: { page: number; rect: DOMRect; area: number } | null = null;
      for (const el of Array.from(
        container.querySelectorAll<HTMLElement>("[data-page-number]"),
      )) {
        const r = el.getBoundingClientRect();
        const w = Math.min(right, r.right) - Math.max(left, r.left);
        const h = Math.min(bottom, r.bottom) - Math.max(top, r.top);
        const area = Math.max(0, w) * Math.max(0, h);
        if (area > 0 && (!best || area > best.area)) {
          best = { page: Number(el.dataset.pageNumber), rect: r, area };
        }
      }
      if (!best) return;

      const pageRect = {
        x: (Math.max(left, best.rect.left) - best.rect.left) / best.rect.width,
        y: (Math.max(top, best.rect.top) - best.rect.top) / best.rect.height,
        w:
          (Math.min(right, best.rect.right) - Math.max(left, best.rect.left)) /
          best.rect.width,
        h:
          (Math.min(bottom, best.rect.bottom) - Math.max(top, best.rect.top)) /
          best.rect.height,
      };

      const { ocr, vision } = useAppStore.getState().settings;
      const useOcr = ocr.enabled && ocr.apiKey.trim().length > 0;
      const useVision = vision.enabled && vision.apiKey.trim().length > 0;
      if (!useOcr && !useVision) return; // 按钮已做禁用，这里兜底

      setRegionResult({ status: "loading", page: best.page });
      try {
        const imageUrl = await renderPageRegionToImage(pdf, best.page, pageRect);
        const res = await fetch(useOcr ? "/api/ocr" : "/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            useOcr ? { imageUrl, ocr } : { imageUrl, vision },
          ),
        });
        const data = (await res.json()) as {
          ok: boolean;
          text?: string;
          error?: string;
        };
        if (!data.ok) throw new Error(data.error || "识别失败");
        setRegionResult({
          status: "ok",
          page: best.page,
          text: (data.text || "").trim(),
        });
      } catch (e) {
        setRegionResult({
          status: "error",
          page: best.page,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [],
  );

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
    // 列表里还有 PDF（切换加载中 / 文件丢失）时不展示上传引导，避免闪烁误导
    if (openPdfsCount > 0) {
      return (
        <div className="flex h-full items-center justify-center bg-muted/40 text-muted-foreground text-sm">
          <Spinner className="mr-2 size-4" />
          正在加载文献…
        </div>
      );
    }
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
        <Button
          disabled={!regionEngineReady}
          onClick={() => setRegionMode((v) => !v)}
          size="sm"
          title={
            regionEngineReady
              ? "框选公式 / 表格 / 图，用 OCR 或视觉模型识别为 LaTeX / Markdown（Esc 退出）"
              : "需在 设置 中开启 OCR 或图像转写后可用"
          }
          variant={regionMode ? "default" : "outline"}
        >
          <Crop className="size-3.5" />
          框选识别
        </Button>
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

      {/* 全局解析进度：解析/OCR 进行中时在工具栏下方显示横幅 + 进度条 */}
      {pdfTextStatus === "parsing" ? (
        <div className="flex shrink-0 items-center gap-3 border-b bg-primary/5 px-4 py-2">
          <Spinner className="size-4 shrink-0 text-primary" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs">
              {pdfTextMode === "ocr" ? "正在 OCR 识别全文" : "正在解析全文"}
              {numPages > 0 ? `（${pdfTextProgress}/${numPages} 页）` : "…"}
            </span>
            {numPages > 0 ? (
              <Progress
                className="gap-0"
                value={Math.round((pdfTextProgress / numPages) * 100)}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 内部滚动区：只有这里滚动，整页外壳不动。外层 relative 包裹供框选覆盖层
          盖住「可视区域」（直接放滚动区内的 absolute 会随内容滚走） */}
      <div className="relative min-h-0 flex-1">
        {regionMode ? (
          <div
            className="absolute inset-0 z-30 cursor-crosshair"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setRegionDrag({
                sx: e.clientX,
                sy: e.clientY,
                cx: e.clientX,
                cy: e.clientY,
              });
            }}
            onPointerMove={(e) => {
              if (regionDrag)
                setRegionDrag({ ...regionDrag, cx: e.clientX, cy: e.clientY });
            }}
            onPointerUp={() => {
              if (regionDrag) void finishRegion(regionDrag);
            }}
          >
            <div className="absolute inset-x-0 top-2 z-10 flex justify-center">
              <span className="rounded-full bg-background/90 px-3 py-1 text-muted-foreground text-xs shadow">
                拖拽框选要识别的公式 / 表格 / 图（Esc 退出）
              </span>
            </div>
            {regionDrag ? <RegionRect drag={regionDrag} /> : null}
          </div>
        ) : null}
      <div
        className="relative h-full overflow-auto overscroll-contain p-4"
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

      {/* 框选识别结果 */}
      <Dialog
        onOpenChange={(o) => {
          if (!o) setRegionResult(null);
        }}
        open={Boolean(regionResult)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              框选识别{regionResult ? `（第 ${regionResult.page} 页）` : ""}
            </DialogTitle>
            <DialogDescription>
              {regionResult?.status === "loading"
                ? "正在识别框选区域…"
                : regionResult?.status === "error"
                  ? `识别失败：${regionResult.error}`
                  : "识别结果（公式为 LaTeX、表格为 Markdown），可复制或作为引用发给 AI"}
            </DialogDescription>
          </DialogHeader>
          {regionResult?.status === "loading" ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="size-5" />
            </div>
          ) : regionResult?.status === "ok" ? (
            <>
              <textarea
                className="h-48 w-full resize-none rounded-md border bg-muted/30 p-2 font-mono text-xs outline-none"
                readOnly
                value={regionResult.text}
              />
              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  onClick={() => {
                    void navigator.clipboard.writeText(regionResult.text ?? "");
                  }}
                  variant="outline"
                >
                  <Copy className="size-3.5" />
                  复制
                </Button>
                <Button
                  onClick={() => {
                    addCitation({
                      text: regionResult.text ?? "",
                      page: regionResult.page,
                      source: fileName ?? "PDF",
                    });
                    setRegionResult(null);
                  }}
                >
                  <Quote className="size-3.5" />
                  引用到对话
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 框选拖拽中的虚线选框（client 坐标，fixed 定位最直接） */
function RegionRect({
  drag,
}: {
  drag: { sx: number; sy: number; cx: number; cy: number };
}) {
  return (
    <div
      className="pointer-events-none fixed z-40 border-2 border-primary border-dashed bg-primary/10"
      style={{
        left: Math.min(drag.sx, drag.cx),
        top: Math.min(drag.sy, drag.cy),
        width: Math.abs(drag.cx - drag.sx),
        height: Math.abs(drag.cy - drag.sy),
      }}
    />
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

async function renderPageCanvas(
  pdf: PDFDocumentProxy,
  pageNum: number,
  targetWidth: number,
): Promise<HTMLCanvasElement> {
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
  return canvas;
}

async function renderPageToImage(
  pdf: PDFDocumentProxy,
  pageNum: number,
  targetWidth = 1500,
): Promise<string> {
  const canvas = await renderPageCanvas(pdf, pageNum, targetWidth);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** 框选识别：渲染整页（2000px 宽，公式细节更清晰）后裁出框选区域，PNG 输出 */
async function renderPageRegionToImage(
  pdf: PDFDocumentProxy,
  pageNum: number,
  rect: { x: number; y: number; w: number; h: number },
): Promise<string> {
  const canvas = await renderPageCanvas(pdf, pageNum, 2000);
  const sx = Math.max(0, Math.floor(rect.x * canvas.width));
  const sy = Math.max(0, Math.floor(rect.y * canvas.height));
  const sw = Math.min(canvas.width - sx, Math.ceil(rect.w * canvas.width));
  const sh = Math.min(canvas.height - sy, Math.ceil(rect.h * canvas.height));
  if (sw < 4 || sh < 4) throw new Error("框选区域过小");
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context 不可用");
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out.toDataURL("image/png");
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
  if (status === "idle" || status === "error") {
    return (
      <div className="flex items-center gap-1">
        <Button
          onClick={onParse}
          size="sm"
          title="解析整篇 PDF 文本层，作为对话上下文发送给 AI（快，但公式/表格还原一般）"
          variant="outline"
        >
          <FileText className="size-3.5" />
          {status === "error" ? "解析失败 · 重试" : "解析全文"}
        </Button>
        {ocrEnabled ? (
          <Button
            onClick={onOcr}
            size="sm"
            title="用 DeepSeek-OCR 逐页识别（慢、按页计费，但公式转 LaTeX、表格结构更准）"
            variant="outline"
          >
            <FileSearch className="size-3.5" />
            OCR 解析
          </Button>
        ) : null}
      </div>
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
  return null;
}
