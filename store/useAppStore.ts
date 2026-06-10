import type { UIMessage } from "ai";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { saveAnnotations } from "@/lib/annotationStore";
import { kvDel, kvGet, kvSet } from "@/lib/kvStore";
import { deletePdf, loadPdf, savePdf } from "@/lib/pdfStore";
import type { Annotation, Citation } from "@/lib/types";

export type Provider = "anthropic" | "openai" | "deepseek";

export interface VisionSettings {
  /** 主模型不支持图像时，用此视觉模型先把图转成文本再喂主模型 */
  enabled: boolean;
  apiKey: string;
  model: string;
  baseURL: string;
}

export interface TranslationSettings {
  /** 关闭时翻译跟随主对话模型；开启时使用下方独立模型 */
  useMainModel: boolean;
  provider: Provider;
  apiKey: string;
  /** OpenAI/Anthropic 兼容接口的自定义 Base URL；留空使用官方默认 */
  baseURL: string;
  /** 留空则用各 provider 的默认模型 */
  model: string;
  /** DeepSeek 思考/推理模式（默认关） */
  deepseekThinking: boolean;
  /** 翻译结果是否保留历史；false=右侧只显示最新一条译文（默认 true） */
  keepHistory: boolean;
}

export interface OcrSettings {
  /** 开启后可用 DeepSeek-OCR 识别扫描件 PDF / 聊天图片 */
  enabled: boolean;
  apiKey: string;
  baseURL: string;
  model: string;
}

export interface Settings {
  provider: Provider;
  apiKey: string;
  /** 站点访问口令：自部署服务端配置 ACCESS_CODE 后，不填 API Key 走站点内置模型时需要 */
  accessCode: string;
  /** OpenAI/Anthropic 兼容接口的自定义 Base URL；留空使用官方默认 */
  baseURL: string;
  /** 留空则用各 provider 的默认模型 */
  model: string;
  translation: TranslationSettings;
  vision: VisionSettings;
  /** DeepSeek-OCR（硅基流动）OCR 引擎，用于扫描件全文与图片识别 */
  ocr: OcrSettings;
  /** DeepSeek 思考/推理模式（默认关，开启会展示思考过程） */
  deepseekThinking: boolean;
  /** 打开 PDF 时是否自动解析全文并作为对话上下文（默认关） */
  autoParseFullText: boolean;
}

/** 整篇 PDF 全文解析状态 */
export type PdfTextStatus = "idle" | "parsing" | "ready" | "error" | "scanned";

export interface OpenPdf {
  id: string;
  name: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: UIMessage[];
  updatedAt: number;
  /** 该会话打开的全部 PDF（文件存 IndexedDB，按 id 取） */
  pdfs?: OpenPdf[];
  /** @deprecated 旧单 PDF 字段，读取兼容；新数据写 pdfs */
  pdfId?: string;
  pdfName?: string;
}

/** 旧会话数据兼容：pdfs 缺失时把 pdfId/pdfName 视为单元素列表 */
export function convPdfs(conv?: Conversation): OpenPdf[] {
  if (!conv) return [];
  if (conv.pdfs?.length) return conv.pdfs;
  return conv.pdfId ? [{ id: conv.pdfId, name: conv.pdfName ?? "PDF" }] : [];
}

function deriveTitle(messages: UIMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "";
  const text = firstUser.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .trim();
  return text.slice(0, 24);
}

let pdfLoadRequest = 0;
let jumpSeq = 0;

/** 把 openPdfs 同步进当前会话（无当前会话则原样返回） */
function syncConvPdfs(
  st: { currentId: string | null; conversations: Conversation[] },
  openPdfs: OpenPdf[],
): Conversation[] {
  if (!st.currentId) return st.conversations;
  return st.conversations.map((c) =>
    c.id === st.currentId
      ? {
          ...c,
          updatedAt: Date.now(),
          pdfs: openPdfs,
          // 旧字段保持指向第一篇，兼容可能读它的旧逻辑
          pdfId: openPdfs[0]?.id,
          pdfName: openPdfs[0]?.name,
        }
      : c,
  );
}

/**
 * persist 的异步 storage：IndexedDB 为主。首次读不到时尝试从旧版
 * localStorage（同名 key）迁移一次，老用户的设置与会话无缝带过来。
 * SSR 阶段（无 window）全部 no-op，水合在客户端异步完成 ——
 * 需要「恢复后才执行」的逻辑请用 useAppStore.persist.onFinishHydration。
 * 注意必须定义在 create() 之前：createJSONStorage 会立即调用工厂函数。
 */
const idbStateStorage: StateStorage = {
  getItem: async (name) => {
    if (typeof window === "undefined") return null;
    const value = await kvGet(name);
    if (value != null) return value;
    const legacy = window.localStorage.getItem(name);
    if (legacy != null) {
      await kvSet(name, legacy);
      window.localStorage.removeItem(name);
      return legacy;
    }
    return null;
  },
  setItem: async (name, value) => {
    if (typeof window === "undefined") return;
    await kvSet(name, value);
  },
  removeItem: async (name) => {
    if (typeof window === "undefined") return;
    await kvDel(name);
  },
};

interface AppState {
  // —— PDF / 引用（不持久化）——
  fileUrl: string | null;
  fileName: string | null;
  pdfId: string | null;
  /** 当前会话打开的全部 PDF；pdfId 是其中正在阅读的那个 */
  openPdfs: OpenPdf[];
  /** 各 PDF 已解析全文的内存缓存（切换阅读不丢，刷新后按需重解析） */
  pdfFullTexts: Record<string, string>;
  numPages: number;
  citations: Citation[];
  /** 当前 PDF 的高亮批注（内存；按 pdfId 单独存 IndexedDB，不进 persist） */
  annotations: Annotation[];
  /** 当前 PDF 解析出的全文（不持久化，按需重新解析） */
  pdfFullText: string | null;
  pdfTextStatus: PdfTextStatus;
  /** 解析进度：已完成页数（配合 numPages 显示） */
  pdfTextProgress: number;
  /** 当前全文来自普通文本层(text)还是 OCR(ocr)，用于状态展示 */
  pdfTextMode: "text" | "ocr";

  // —— 设置 / 会话（持久化到 localStorage）——
  settings: Settings;
  conversations: Conversation[];
  currentId: string | null;
  // PDF 偏好（持久化）
  pdfColorMode: "light" | "sepia" | "dark";
  pdfPinchZoom: boolean;
  /** 多 PDF 侧边栏展开/折叠（持久化） */
  pdfSidebarOpen: boolean;
  // 右侧模式：对话 / 翻译；翻译模式下左侧划选即自动翻译
  mode: "chat" | "translate";
  pendingTranslate: string | null;
  /** 待确认上传的 PDF：当前对话已在进行时先暂存，等用户选「开新 / 加当前」 */
  pendingPdf: File | null;
  /** 跳转信号：点击 AI 回答里的页码引用时设置，阅读器监听并滚动高亮（n 去重）；
   *  quote 为 AI 抄录的原文片段，用于在文本层定位到具体句子 */
  pdfJump: { page: number; quote?: string; n: number } | null;

  /** 上传 PDF：加入当前会话列表并切换为正在阅读 */
  openPdf: (file: File) => void;
  /** 切换正在阅读的 PDF（从 IndexedDB 取文件重建 objectURL） */
  activatePdf: (id: string) => Promise<void>;
  /** 从当前会话移除一个 PDF（不删 IndexedDB 文件，历史会话可能还引用） */
  removePdf: (id: string) => void;
  /** 移除当前正在阅读的 PDF（工具栏 ×） */
  closePdf: () => void;
  /** 清空打开的全部 PDF（「开新对话」带新文献时用） */
  resetPdfs: () => void;
  setPdfSidebarOpen: (v: boolean) => void;
  setNumPages: (n: number) => void;
  addCitation: (c: Omit<Citation, "id">) => void;
  removeCitation: (id: string) => void;
  clearCitations: () => void;
  /** 切换 PDF 时由阅读器从 IndexedDB 载入该 PDF 的高亮 */
  setAnnotations: (items: Annotation[]) => void;
  addAnnotation: (a: Omit<Annotation, "id" | "createdAt">) => void;
  removeAnnotation: (id: string) => void;
  updateAnnotation: (id: string, patch: Pick<Annotation, "note">) => void;
  /** 写入/清空全文（传 null 清空，状态回 idle） */
  setPdfFullText: (text: string | null) => void;
  setPdfTextStatus: (status: PdfTextStatus, progress?: number) => void;
  setPdfTextMode: (mode: "text" | "ocr") => void;

  setSettings: (s: Partial<Settings>) => void;
  hasApiKey: () => boolean;
  setPdfColorMode: (m: "light" | "sepia" | "dark") => void;
  setPdfPinchZoom: (v: boolean) => void;
  setMode: (m: "chat" | "translate") => void;
  setPendingTranslate: (t: string | null) => void;
  setPendingPdf: (f: File | null) => void;
  jumpToPage: (page: number, quote?: string) => void;

  /** 确保存在当前会话，返回其 id */
  ensureConversation: () => string;
  /** 把消息写入当前会话（流结束时调用） */
  upsertCurrent: (messages: UIMessage[]) => void;
  /** 开新对话（下次发消息时创建） */
  newConversation: () => void;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  /** 加载某会话当时的 PDF（切换会话 / 刷新恢复时调用） */
  loadConversationPdf: (conv?: Conversation) => Promise<void>;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      fileUrl: null,
      fileName: null,
      pdfId: null,
      openPdfs: [],
      pdfFullTexts: {},
      numPages: 0,
      citations: [],
      annotations: [],
      pdfFullText: null,
      pdfTextStatus: "idle",
      pdfTextProgress: 0,
      pdfTextMode: "text",

      settings: {
        provider: "anthropic",
        apiKey: "",
        accessCode: "",
        baseURL: "",
        model: "",
        translation: {
          useMainModel: true,
          provider: "deepseek",
          apiKey: "",
          baseURL: "",
          model: "deepseek-v4-flash",
          deepseekThinking: false,
          keepHistory: true,
        },
        vision: {
          enabled: false,
          apiKey: "",
          model: "qwen3-vl-flash",
          baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        },
        ocr: {
          enabled: false,
          apiKey: "",
          baseURL: "https://api.siliconflow.cn/v1",
          model: "deepseek-ai/DeepSeek-OCR",
        },
        deepseekThinking: false,
        autoParseFullText: false,
      },
      conversations: [],
      currentId: null,
      pdfColorMode: "light",
      pdfPinchZoom: false,
      pdfSidebarOpen: true,
      mode: "chat",
      pendingTranslate: null,
      pendingPdf: null,
      pdfJump: null,

      openPdf: (file) => {
        pdfLoadRequest += 1;
        const prev = get().fileUrl;
        if (prev) URL.revokeObjectURL(prev);
        const id = crypto.randomUUID();
        const fileName = file.name;
        void savePdf(id, file); // 后台存入 IndexedDB，供切换 / 历史会话恢复
        set((st) => {
          const openPdfs = [...st.openPdfs, { id, name: fileName }];
          return {
            fileUrl: URL.createObjectURL(file),
            fileName,
            pdfId: id,
            openPdfs,
            numPages: 0,
            pdfFullText: null,
            pdfTextStatus: "idle" as const,
            pdfTextProgress: 0,
            conversations: syncConvPdfs(st, openPdfs),
          };
        });
      },
      activatePdf: async (id) => {
        const st = get();
        if (id === st.pdfId || !st.openPdfs.some((p) => p.id === id)) return;
        const request = ++pdfLoadRequest;
        let file: File | undefined;
        try {
          file = await loadPdf(id);
        } catch {
          file = undefined;
        }
        if (request !== pdfLoadRequest) return; // 期间又切换了
        if (!file) return; // 文件丢失：保持现状（极端情况，列表项还在可重试）
        const prev = get().fileUrl;
        if (prev) URL.revokeObjectURL(prev);
        set((s) => {
          const cached = s.pdfFullTexts[id];
          return {
            fileUrl: URL.createObjectURL(file),
            fileName: s.openPdfs.find((p) => p.id === id)?.name ?? file.name,
            pdfId: id,
            numPages: 0,
            pdfFullText: cached ?? null,
            pdfTextStatus: cached ? ("ready" as const) : ("idle" as const),
            pdfTextProgress: 0,
          };
        });
      },
      removePdf: (id) => {
        const st = get();
        if (!st.openPdfs.some((p) => p.id === id)) return;
        const rest = st.openPdfs.filter((p) => p.id !== id);
        if (id !== st.pdfId) {
          set((s) => ({
            openPdfs: rest,
            conversations: syncConvPdfs(s, rest),
          }));
          return;
        }
        // 移除的是正在阅读的：切到剩下的第一个，没有则清空阅读器
        pdfLoadRequest += 1;
        const prev = st.fileUrl;
        if (prev) URL.revokeObjectURL(prev);
        set((s) => ({
          openPdfs: rest,
          fileUrl: null,
          fileName: null,
          pdfId: null,
          numPages: 0,
          pdfFullText: null,
          pdfTextStatus: "idle" as const,
          pdfTextProgress: 0,
          conversations: syncConvPdfs(s, rest),
        }));
        if (rest.length > 0) void get().activatePdf(rest[0].id);
      },
      closePdf: () => {
        const { pdfId } = get();
        if (pdfId) get().removePdf(pdfId);
      },
      resetPdfs: () => {
        pdfLoadRequest += 1;
        const prev = get().fileUrl;
        if (prev) URL.revokeObjectURL(prev);
        set({
          fileUrl: null,
          fileName: null,
          pdfId: null,
          openPdfs: [],
          numPages: 0,
          pdfFullText: null,
          pdfTextStatus: "idle",
          pdfTextProgress: 0,
        });
      },
      setPdfSidebarOpen: (v) => set({ pdfSidebarOpen: v }),
      setNumPages: (n) => set({ numPages: n }),
      addCitation: (c) =>
        set((s) => ({
          citations: [...s.citations, { ...c, id: crypto.randomUUID() }],
        })),
      removeCitation: (id) =>
        set((s) => ({ citations: s.citations.filter((x) => x.id !== id) })),
      clearCitations: () => set({ citations: [] }),
      setAnnotations: (items) => set({ annotations: items }),
      addAnnotation: (a) => {
        const item: Annotation = {
          ...a,
          id: crypto.randomUUID(),
          createdAt: Date.now(),
        };
        set((s) => {
          const annotations = [...s.annotations, item];
          if (s.pdfId) void saveAnnotations(s.pdfId, annotations);
          return { annotations };
        });
      },
      removeAnnotation: (id) =>
        set((s) => {
          const annotations = s.annotations.filter((x) => x.id !== id);
          if (s.pdfId) void saveAnnotations(s.pdfId, annotations);
          return { annotations };
        }),
      updateAnnotation: (id, patch) =>
        set((s) => {
          const annotations = s.annotations.map((x) =>
            x.id === id ? { ...x, ...patch } : x,
          );
          if (s.pdfId) void saveAnnotations(s.pdfId, annotations);
          return { annotations };
        }),
      setPdfFullText: (text) =>
        set((s) => {
          // 同步写入缓存：切换 PDF 再切回来不用重新解析
          const pdfFullTexts = { ...s.pdfFullTexts };
          if (s.pdfId) {
            if (text) pdfFullTexts[s.pdfId] = text;
            else delete pdfFullTexts[s.pdfId];
          }
          return {
            pdfFullText: text,
            pdfFullTexts,
            pdfTextStatus: text ? "ready" : "idle",
            pdfTextProgress: 0,
          };
        }),
      setPdfTextStatus: (status, progress) =>
        set((s) => ({
          pdfTextStatus: status,
          pdfTextProgress: progress ?? s.pdfTextProgress,
        })),
      setPdfTextMode: (mode) => set({ pdfTextMode: mode }),

      setSettings: (s) =>
        set((st) => ({ settings: { ...st.settings, ...s } })),
      hasApiKey: () => get().settings.apiKey.trim().length > 0,
      setPdfColorMode: (m) => set({ pdfColorMode: m }),
      setPdfPinchZoom: (v) => set({ pdfPinchZoom: v }),
      setMode: (m) => set({ mode: m }),
      setPendingTranslate: (t) => set({ pendingTranslate: t }),
      setPendingPdf: (f) => set({ pendingPdf: f }),
      jumpToPage: (page, quote) =>
        set({ pdfJump: { page, quote, n: ++jumpSeq } }),

      ensureConversation: () => {
        const { currentId, conversations, openPdfs } = get();
        if (currentId && conversations.some((c) => c.id === currentId)) {
          return currentId;
        }
        const id = crypto.randomUUID();
        set((st) => ({
          currentId: id,
          conversations: [
            {
              id,
              title: "新对话",
              messages: [],
              updatedAt: Date.now(),
              pdfs: openPdfs,
              pdfId: openPdfs[0]?.id,
              pdfName: openPdfs[0]?.name,
            },
            ...st.conversations,
          ],
        }));
        return id;
      },
      upsertCurrent: (messages) =>
        set((st) => {
          const id = st.currentId;
          if (!id || messages.length === 0) return {};
          const title = deriveTitle(messages) || "新对话";
          const pdfs = st.openPdfs;
          const base = {
            title,
            messages,
            updatedAt: Date.now(),
            pdfs,
            pdfId: pdfs[0]?.id,
            pdfName: pdfs[0]?.name,
          };
          const exists = st.conversations.some((c) => c.id === id);
          const conversations = exists
            ? st.conversations.map((c) => (c.id === id ? { ...c, ...base } : c))
            : [{ id, ...base }, ...st.conversations];
          return { conversations };
        }),
      newConversation: () => set({ currentId: null }),
      switchConversation: (id) => set({ currentId: id }),
      loadConversationPdf: async (conv) => {
        const request = ++pdfLoadRequest;
        const pdfs = convPdfs(conv);
        const first = pdfs[0];
        if (first) {
          let file: File | undefined;
          try {
            file = await loadPdf(first.id);
          } catch {
            file = undefined;
          }
          if (request !== pdfLoadRequest) return;
          if (file) {
            const prev = get().fileUrl;
            if (prev) URL.revokeObjectURL(prev);
            set((s) => {
              const cached = s.pdfFullTexts[first.id];
              return {
                fileUrl: URL.createObjectURL(file),
                fileName: first.name,
                pdfId: first.id,
                openPdfs: pdfs,
                numPages: 0,
                citations: [],
                pdfFullText: cached ?? null,
                pdfTextStatus: cached ? "ready" : "idle",
                pdfTextProgress: 0,
              };
            });
            return;
          }
        }
        // 该会话没有关联 PDF（或第一篇文件已丢失）：清空阅读器
        if (request !== pdfLoadRequest) return;
        const prev = get().fileUrl;
        if (prev) URL.revokeObjectURL(prev);
        set({
          fileUrl: null,
          fileName: null,
          pdfId: null,
          // 文件丢失时仍保留列表（pdfs 非空时可手动点其他篇重试）
          openPdfs: pdfs,
          numPages: 0,
          citations: [],
          pdfFullText: null,
          pdfTextStatus: "idle",
          pdfTextProgress: 0,
        });
      },
      deleteConversation: (id) =>
        set((st) => {
          const nextConversations = st.conversations.filter((c) => c.id !== id);
          const conv = st.conversations.find((c) => c.id === id);
          // 引用计数清理：该会话引用的 PDF 不再被其他会话引用时，删 IndexedDB 文件
          const stillUsed = new Set(
            nextConversations.flatMap((c) => convPdfs(c).map((p) => p.id)),
          );
          for (const p of convPdfs(conv)) {
            if (!stillUsed.has(p.id)) void deletePdf(p.id);
          }
          return {
            conversations: nextConversations,
            currentId: st.currentId === id ? null : st.currentId,
          };
        }),
    }),
    {
      name: "chatpaper",
      // 仅持久化设置与会话；PDF blob / 引用不持久化
      partialize: (s) => ({
        settings: s.settings,
        conversations: s.conversations,
        currentId: s.currentId,
        pdfColorMode: s.pdfColorMode,
        pdfPinchZoom: s.pdfPinchZoom,
        pdfSidebarOpen: s.pdfSidebarOpen,
        mode: s.mode,
      }),
      // 旧数据可能没有 settings.vision，深合并补默认，避免读取报错
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...p,
          settings: {
            ...current.settings,
            ...(p.settings ?? {}),
            vision: {
              ...current.settings.vision,
              ...(p.settings?.vision ?? {}),
            },
            translation: {
              ...current.settings.translation,
              ...(p.settings?.translation ?? {}),
            },
            ocr: {
              ...current.settings.ocr,
              ...(p.settings?.ocr ?? {}),
            },
          },
        };
      },
      storage: createJSONStorage(() => idbStateStorage),
    },
  ),
);
