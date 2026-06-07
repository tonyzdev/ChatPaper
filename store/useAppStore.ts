import type { UIMessage } from "ai";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { deletePdf, loadPdf, savePdf } from "@/lib/pdfStore";
import type { Citation } from "@/lib/types";

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

export interface Conversation {
  id: string;
  title: string;
  messages: UIMessage[];
  updatedAt: number;
  /** 该会话当时打开的 PDF（文件存 IndexedDB，按 id 取） */
  pdfId?: string;
  pdfName?: string;
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

interface AppState {
  // —— PDF / 引用（不持久化）——
  fileUrl: string | null;
  fileName: string | null;
  pdfId: string | null;
  numPages: number;
  citations: Citation[];
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
  // 右侧模式：对话 / 翻译；翻译模式下左侧划选即自动翻译
  mode: "chat" | "translate";
  pendingTranslate: string | null;

  openPdf: (file: File) => void;
  closePdf: () => void;
  setNumPages: (n: number) => void;
  addCitation: (c: Omit<Citation, "id">) => void;
  removeCitation: (id: string) => void;
  clearCitations: () => void;
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
      numPages: 0,
      citations: [],
      pdfFullText: null,
      pdfTextStatus: "idle",
      pdfTextProgress: 0,
      pdfTextMode: "text",

      settings: {
        provider: "anthropic",
        apiKey: "",
        baseURL: "",
        model: "",
        translation: {
          useMainModel: true,
          provider: "deepseek",
          apiKey: "",
          baseURL: "",
          model: "deepseek-v4-flash",
          deepseekThinking: false,
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
      mode: "chat",
      pendingTranslate: null,

      openPdf: (file) => {
        const prev = get().fileUrl;
        if (prev) URL.revokeObjectURL(prev);
        const id = crypto.randomUUID();
        void savePdf(id, file); // 后台存入 IndexedDB，供历史会话恢复
        set({
          fileUrl: URL.createObjectURL(file),
          fileName: file.name,
          pdfId: id,
          numPages: 0,
          citations: [],
          pdfFullText: null,
          pdfTextStatus: "idle",
          pdfTextProgress: 0,
        });
      },
      closePdf: () => {
        const prev = get().fileUrl;
        if (prev) URL.revokeObjectURL(prev);
        set({
          fileUrl: null,
          fileName: null,
          pdfId: null,
          numPages: 0,
          citations: [],
          pdfFullText: null,
          pdfTextStatus: "idle",
          pdfTextProgress: 0,
        });
      },
      setNumPages: (n) => set({ numPages: n }),
      addCitation: (c) =>
        set((s) => ({
          citations: [...s.citations, { ...c, id: crypto.randomUUID() }],
        })),
      removeCitation: (id) =>
        set((s) => ({ citations: s.citations.filter((x) => x.id !== id) })),
      clearCitations: () => set({ citations: [] }),
      setPdfFullText: (text) =>
        set({
          pdfFullText: text,
          pdfTextStatus: text ? "ready" : "idle",
          pdfTextProgress: 0,
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

      ensureConversation: () => {
        const { currentId, conversations } = get();
        if (currentId && conversations.some((c) => c.id === currentId)) {
          return currentId;
        }
        const id = crypto.randomUUID();
        set((st) => ({
          currentId: id,
          conversations: [
            { id, title: "新对话", messages: [], updatedAt: Date.now() },
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
          const pdfId = st.pdfId ?? undefined;
          const pdfName = st.fileName ?? undefined;
          const exists = st.conversations.some((c) => c.id === id);
          const conversations = exists
            ? st.conversations.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      messages,
                      title,
                      updatedAt: Date.now(),
                      pdfId,
                      pdfName,
                    }
                  : c,
              )
            : [
                { id, title, messages, updatedAt: Date.now(), pdfId, pdfName },
                ...st.conversations,
              ];
          return { conversations };
        }),
      newConversation: () => set({ currentId: null }),
      switchConversation: (id) => set({ currentId: id }),
      loadConversationPdf: async (conv) => {
        const prev = get().fileUrl;
        if (conv?.pdfId) {
          const file = await loadPdf(conv.pdfId);
          if (file) {
            if (prev) URL.revokeObjectURL(prev);
            set({
              fileUrl: URL.createObjectURL(file),
              fileName: conv.pdfName ?? file.name,
              pdfId: conv.pdfId,
              numPages: 0,
              citations: [],
              pdfFullText: null,
              pdfTextStatus: "idle",
              pdfTextProgress: 0,
            });
            return;
          }
        }
        // 该会话没有关联 PDF（或文件已丢失）：清空阅读器
        if (prev) URL.revokeObjectURL(prev);
        set({
          fileUrl: null,
          fileName: null,
          pdfId: null,
          numPages: 0,
          citations: [],
          pdfFullText: null,
          pdfTextStatus: "idle",
          pdfTextProgress: 0,
        });
      },
      deleteConversation: (id) =>
        set((st) => {
          const conv = st.conversations.find((c) => c.id === id);
          if (conv?.pdfId) void deletePdf(conv.pdfId);
          return {
            conversations: st.conversations.filter((c) => c.id !== id),
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
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? window.localStorage
          : {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            },
      ),
    },
  ),
);
