import type { UIMessage } from "ai";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { deleteAnnotations, saveAnnotations } from "@/lib/annotationStore";
import { kvDel, kvGet, kvSet } from "@/lib/kvStore";
import { deletePdf, loadPdf, savePdf } from "@/lib/pdfStore";
import type { Annotation, Citation } from "@/lib/types";
import type { ContextEngine, ContextScope } from "@/lib/openNotebook";

export type Provider = "anthropic" | "openai" | "deepseek";

export type ChatAnswerMode = "direct" | "agent";

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

export interface OpenNotebookSettings {
  baseUrl: string;
  password: string;
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
  /** 项目级上下文引擎：内置全文注入 or Open Notebook 同步 */
  contextEngine: ContextEngine;
  /** 回答时默认参考左侧当前 PDF，或整个项目知识库 */
  contextScope: ContextScope;
  /** 普通直答，或用 ReAct Agent 先检索项目文档再回答 */
  chatAnswerMode: ChatAnswerMode;
  openNotebook: OpenNotebookSettings;
}

/** 整篇 PDF 全文解析状态 */
export type PdfTextStatus = "idle" | "parsing" | "ready" | "error" | "scanned";

export interface OpenPdf {
  id: string;
  name: string;
  size?: number;
  lastModified?: number;
}

function normalizedPdfName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function openPdfDedupeKey(pdf: OpenPdf): string {
  const name = normalizedPdfName(pdf.name);
  if (typeof pdf.size !== "number" || typeof pdf.lastModified !== "number") {
    return name;
  }
  return `${name}\0${pdf.size}\0${pdf.lastModified}`;
}

function dedupeOpenPdfs(pdfs: OpenPdf[]): OpenPdf[] {
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  const legacyNames = new Set<string>();
  const result: OpenPdf[] = [];

  for (const pdf of pdfs) {
    const key = openPdfDedupeKey(pdf);
    const name = normalizedPdfName(pdf.name);
    const legacy = typeof pdf.size !== "number" || typeof pdf.lastModified !== "number";
    if (seen.has(key) || legacyNames.has(name) || (legacy && seenNames.has(name))) {
      continue;
    }
    seen.add(key);
    seenNames.add(name);
    if (legacy) legacyNames.add(name);
    result.push(pdf);
  }
  return result;
}

export function findDuplicatePdf(pdfs: OpenPdf[], file: File): OpenPdf | undefined {
  const name = normalizedPdfName(file.name);
  return pdfs.find((pdf) => {
    if (normalizedPdfName(pdf.name) !== name) return false;
    if (typeof pdf.size !== "number" || typeof pdf.lastModified !== "number") {
      return true;
    }
    return pdf.size === file.size && pdf.lastModified === file.lastModified;
  });
}

export interface Conversation {
  id: string;
  title: string;
  messages: UIMessage[];
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  updatedAt: number;
  pdfs: OpenPdf[];
  currentPdfId: string | null;
  conversations: Conversation[];
  currentConversationId: string | null;
}

interface LegacyConversation {
  id?: string;
  title?: string;
  messages?: UIMessage[];
  updatedAt?: number;
  pdfs?: OpenPdf[];
  pdfId?: string;
  pdfName?: string;
}

interface PersistedStateShape {
  settings?: Settings;
  projects?: Project[];
  currentProjectId?: string | null;
  pdfColorMode?: "light" | "sepia" | "dark";
  pdfPinchZoom?: boolean;
  pdfSidebarOpen?: boolean;
  chatOpen?: boolean;
  mode?: "chat" | "translate";
}

interface LegacyPersistedState extends PersistedStateShape {
  conversations?: LegacyConversation[];
  currentId?: string | null;
}

interface ProjectStateSlice {
  projects: Project[];
  currentProjectId: string | null;
}

const EMPTY_CONVERSATIONS: Conversation[] = [];
const EMPTY_PROJECT_PDFS: OpenPdf[] = [];

export function currentProject(st: ProjectStateSlice): Project | undefined {
  return st.projects.find((p) => p.id === st.currentProjectId);
}

export function currentProjectConversations(st: ProjectStateSlice): Conversation[] {
  return currentProject(st)?.conversations ?? EMPTY_CONVERSATIONS;
}

export function currentProjectPdfs(st: ProjectStateSlice): OpenPdf[] {
  return currentProject(st)?.pdfs ?? EMPTY_PROJECT_PDFS;
}

export function currentConversation(
  st: ProjectStateSlice,
): Conversation | undefined {
  const project = currentProject(st);
  if (!project?.currentConversationId) return undefined;
  return project.conversations.find(
    (c) => c.id === project.currentConversationId,
  );
}

export function pdfSummary(pdfs: OpenPdf[]): string {
  if (pdfs.length === 0) return "未关联 PDF";
  if (pdfs.length === 1) return pdfs[0].name;
  return `${pdfs[0].name} 等 ${pdfs.length} 篇`;
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

function stripPdfExtension(name?: string | null): string {
  return (name ?? "").replace(/\.pdf$/i, "").trim();
}

function defaultProjectName(projects: Pick<Project, "name">[]): string {
  let index = projects.length + 1;
  while (projects.some((p) => p.name === `项目 ${index}`)) index += 1;
  return `项目 ${index}`;
}

function resolveProjectName(
  projects: Pick<Project, "name">[],
  preferred?: string,
): string {
  const trimmed = preferred?.trim();
  if (!trimmed) return defaultProjectName(projects);
  const stripped = stripPdfExtension(trimmed);
  return stripped || trimmed;
}

function normalizeConversation(conv: Partial<Conversation>): Conversation {
  return {
    id: conv.id ?? crypto.randomUUID(),
    title: conv.title?.trim() || "新对话",
    messages: Array.isArray(conv.messages) ? conv.messages : [],
    updatedAt: typeof conv.updatedAt === "number" ? conv.updatedAt : Date.now(),
  };
}

function normalizeProject(project: Partial<Project>, index: number): Project {
  const conversations = Array.isArray(project.conversations)
    ? project.conversations.map(normalizeConversation)
    : [];
  const pdfs = Array.isArray(project.pdfs) ? dedupeOpenPdfs(project.pdfs) : [];
  const currentConversationId =
    project.currentConversationId &&
    conversations.some((c) => c.id === project.currentConversationId)
      ? project.currentConversationId
      : null;
  const currentPdfId =
    project.currentPdfId && pdfs.some((p) => p.id === project.currentPdfId)
      ? project.currentPdfId
      : (pdfs[0]?.id ?? null);

  return {
    id: project.id ?? crypto.randomUUID(),
    name: project.name?.trim() || `项目 ${index + 1}`,
    updatedAt: typeof project.updatedAt === "number" ? project.updatedAt : Date.now(),
    pdfs,
    currentPdfId,
    conversations,
    currentConversationId,
  };
}

function normalizeProjects(
  projects?: Project[],
  currentProjectId?: string | null,
): { projects: Project[]; currentProjectId: string | null } {
  const next = Array.isArray(projects)
    ? projects.map((project, index) => normalizeProject(project, index))
    : [];
  const active = next.some((p) => p.id === currentProjectId)
    ? (currentProjectId ?? null)
    : (next[0]?.id ?? null);
  return { projects: next, currentProjectId: active };
}

function legacyConversationPdfs(conv?: LegacyConversation): OpenPdf[] {
  if (!conv) return [];
  if (conv.pdfs?.length) return conv.pdfs;
  return conv.pdfId ? [{ id: conv.pdfId, name: conv.pdfName ?? "PDF" }] : [];
}

export function migrateLegacyProjects(
  conversations?: LegacyConversation[],
  currentId?: string | null,
): { projects: Project[]; currentProjectId: string | null } {
  if (!Array.isArray(conversations) || conversations.length === 0) {
    return { projects: [], currentProjectId: null };
  }

  const projects = conversations.map((legacy, index) => {
    const conversation = normalizeConversation(legacy);
    const pdfs = dedupeOpenPdfs(legacyConversationPdfs(legacy));
    return {
      id: crypto.randomUUID(),
      name:
        stripPdfExtension(pdfs[0]?.name) ||
        conversation.title ||
        `项目 ${index + 1}`,
      updatedAt: conversation.updatedAt,
      pdfs,
      currentPdfId: pdfs[0]?.id ?? null,
      conversations: [conversation],
      currentConversationId: conversation.id,
    } satisfies Project;
  });

  const active =
    projects.find((project) => project.currentConversationId === currentId)?.id ??
    projects[0]?.id ??
    null;

  return { projects, currentProjectId: active };
}

function mapCurrentProject<T extends ProjectStateSlice>(
  st: T,
  updater: (project: Project) => Project,
): Project[] {
  return st.projects.map((project) =>
    project.id === st.currentProjectId ? updater(project) : project,
  );
}


let pdfLoadRequest = 0;
let jumpSeq = 0;

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

  // —— 设置 / 项目（持久化）——
  settings: Settings;
  projects: Project[];
  currentProjectId: string | null;
  // PDF 偏好（持久化）
  pdfColorMode: "light" | "sepia" | "dark";
  pdfPinchZoom: boolean;
  /** 多 PDF 侧边栏展开/折叠（持久化） */
  pdfSidebarOpen: boolean;
  /** 悬浮聊天卡片展开/收起（持久化；收起后右下角剩一个悬浮圆钮） */
  chatOpen: boolean;
  // 右侧模式：对话 / 翻译；翻译模式下左侧划选即自动翻译
  mode: "chat" | "translate";
  pendingTranslate: string | null;
  /** 待确认上传的 PDF：当前项目已在进行时先暂存，等用户选「开新项目 / 加当前」 */
  pendingPdf: File | null;
  /** 跳转信号：点击 AI 回答里的页码引用时设置，阅读器监听并滚动高亮（n 去重）；
   *  quote 为 AI 抄录的原文片段，用于在文本层定位到具体句子 */
  pdfJump: { page: number; quote?: string; n: number } | null;

  /** 上传 PDF：加入当前项目列表并切换为正在阅读 */
  openPdf: (file: File) => void;
  /** 切换正在阅读的 PDF（从 IndexedDB 取文件重建 objectURL） */
  activatePdf: (id: string) => Promise<void>;
  /** 从当前项目移除一个 PDF */
  removePdf: (id: string) => void;
  /** 移除当前正在阅读的 PDF（工具栏 ×） */
  closePdf: () => void;
  setPdfSidebarOpen: (v: boolean) => void;
  setChatOpen: (v: boolean) => void;
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

  ensureProject: (name?: string) => string;
  createProject: (name?: string) => string;
  switchProject: (id: string) => void;
  deleteProject: (id: string) => string | null;
  /** 确保存在当前会话，返回其 id */
  ensureConversation: () => string;
  /** 把消息写入当前会话（流结束时调用） */
  upsertCurrent: (messages: UIMessage[]) => void;
  /** 开新对话（下次发消息时创建） */
  newConversation: () => void;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  /** 加载当前项目的 PDF（切项目 / 刷新恢复时调用） */
  loadCurrentProjectPdf: () => Promise<void>;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      fileUrl: null,
      fileName: null,
      pdfId: null,
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
        contextEngine: "builtin",
        contextScope: "current-pdf",
        chatAnswerMode: "direct",
        openNotebook: {
          baseUrl: "",
          password: "",
        },
      },
      projects: [],
      currentProjectId: null,
      pdfColorMode: "light",
      pdfPinchZoom: false,
      pdfSidebarOpen: true,
      chatOpen: true,
      mode: "chat",
      pendingTranslate: null,
      pendingPdf: null,
      pdfJump: null,

      openPdf: (file) => {
        const fileName = file.name;
        const projectId = get().ensureProject(stripPdfExtension(fileName));
        const project = get().projects.find((item) => item.id === projectId);
        const duplicate = project ? findDuplicatePdf(project.pdfs, file) : undefined;
        if (duplicate) {
          void get().activatePdf(duplicate.id);
          return;
        }

        pdfLoadRequest += 1;
        const prev = get().fileUrl;
        if (prev) URL.revokeObjectURL(prev);
        const id = crypto.randomUUID();
        void savePdf(id, file);
        set((st) => ({
          fileUrl: URL.createObjectURL(file),
          fileName,
          pdfId: id,
          numPages: 0,
          pdfFullText: null,
          pdfTextStatus: "idle",
          pdfTextProgress: 0,
          projects: st.projects.map((project) =>
            project.id === projectId
              ? {
                  ...project,
                  updatedAt: Date.now(),
                  pdfs: [
                    ...project.pdfs,
                    {
                      id,
                      name: fileName,
                      size: file.size,
                      lastModified: file.lastModified,
                    },
                  ],
                  currentPdfId: id,
                }
              : project,
          ),
        }));
      },
      activatePdf: async (id) => {
        const project = currentProject(get());
        if (!project?.pdfs.some((p) => p.id === id) || id === get().pdfId) return;
        const request = ++pdfLoadRequest;
        let file: File | undefined;
        try {
          file = await loadPdf(id);
        } catch {
          file = undefined;
        }
        if (request !== pdfLoadRequest || !file) return;
        const prev = get().fileUrl;
        if (prev) URL.revokeObjectURL(prev);
        set((st) => {
          const cached = st.pdfFullTexts[id];
          return {
            fileUrl: URL.createObjectURL(file),
            fileName: project.pdfs.find((p) => p.id === id)?.name ?? file.name,
            pdfId: id,
            numPages: 0,
            pdfFullText: cached ?? null,
            pdfTextStatus: cached ? "ready" : "idle",
            pdfTextProgress: 0,
            projects: mapCurrentProject(st, (current) => ({
              ...current,
              currentPdfId: id,
            })),
          };
        });
      },
      removePdf: (id) => {
        const st = get();
        const project = currentProject(st);
        if (!project?.pdfs.some((pdf) => pdf.id === id)) return;
        const rest = project.pdfs.filter((pdf) => pdf.id !== id);
        const nextProjects = st.projects.map((item) =>
          item.id === project.id
            ? {
                ...item,
                updatedAt: Date.now(),
                pdfs: rest,
                currentPdfId:
                  item.currentPdfId === id ? (rest[0]?.id ?? null) : item.currentPdfId,
              }
            : item,
        );
        const stillUsed = new Set(
          nextProjects.flatMap((item) => item.pdfs.map((pdf) => pdf.id)),
        );
        if (!stillUsed.has(id)) {
          void deletePdf(id);
          void deleteAnnotations(id);
        }

        if (id !== st.pdfId) {
          set({ projects: nextProjects });
          return;
        }

        pdfLoadRequest += 1;
        const prev = st.fileUrl;
        if (prev) URL.revokeObjectURL(prev);
        set({
          projects: nextProjects,
          fileUrl: null,
          fileName: null,
          pdfId: null,
          numPages: 0,
          pdfFullText: null,
          pdfTextStatus: "idle",
          pdfTextProgress: 0,
        });
        if (rest.length > 0) void get().activatePdf(rest[0].id);
      },
      closePdf: () => {
        const { pdfId } = get();
        if (pdfId) get().removePdf(pdfId);
      },
      setPdfSidebarOpen: (v) => set({ pdfSidebarOpen: v }),
      setChatOpen: (v) => set({ chatOpen: v }),
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

      ensureProject: (name) => {
        const project = currentProject(get());
        if (project) return project.id;
        return get().createProject(name);
      },
      createProject: (name) => {
        const id = crypto.randomUUID();
        set((st) => ({
          currentProjectId: id,
          projects: [
            {
              id,
              name: resolveProjectName(st.projects, name),
              updatedAt: Date.now(),
              pdfs: [],
              currentPdfId: null,
              conversations: [],
              currentConversationId: null,
            },
            ...st.projects,
          ],
        }));
        return id;
      },
      switchProject: (id) =>
        set((st) => ({
          currentProjectId: st.projects.some((project) => project.id === id)
            ? id
            : st.currentProjectId,
        })),
      deleteProject: (id) => {
        const st = get();
        const project = st.projects.find((item) => item.id === id);
        if (!project) return st.currentProjectId;
        const nextProjects = st.projects.filter((item) => item.id !== id);
        const stillUsed = new Set(
          nextProjects.flatMap((item) => item.pdfs.map((pdf) => pdf.id)),
        );
        for (const pdf of project.pdfs) {
          if (!stillUsed.has(pdf.id)) {
            void deletePdf(pdf.id);
            void deleteAnnotations(pdf.id);
          }
        }
        const nextId =
          st.currentProjectId === id
            ? (nextProjects[0]?.id ?? null)
            : st.currentProjectId;
        set({ projects: nextProjects, currentProjectId: nextId });
        return nextId;
      },
      ensureConversation: () => {
        const projectId = get().ensureProject();
        const project = currentProject(get());
        if (
          project?.currentConversationId &&
          project.conversations.some((c) => c.id === project.currentConversationId)
        ) {
          return project.currentConversationId;
        }
        const id = crypto.randomUUID();
        set((st) => ({
          projects: st.projects.map((item) =>
            item.id === projectId
              ? {
                  ...item,
                  updatedAt: Date.now(),
                  currentConversationId: id,
                  conversations: [
                    {
                      id,
                      title: "新对话",
                      messages: [],
                      updatedAt: Date.now(),
                    },
                    ...item.conversations,
                  ],
                }
              : item,
          ),
        }));
        return id;
      },
      upsertCurrent: (messages) =>
        set((st) => {
          const project = currentProject(st);
          const id = project?.currentConversationId;
          if (!project || !id || messages.length === 0) return {};
          const title = deriveTitle(messages) || "新对话";
          const updatedAt = Date.now();
          const base = {
            title,
            messages,
            updatedAt,
          };
          const exists = project.conversations.some((conversation) => conversation.id === id);
          return {
            projects: st.projects.map((item) =>
              item.id === project.id
                ? {
                    ...item,
                    updatedAt,
                    conversations: exists
                      ? item.conversations.map((conversation) =>
                          conversation.id === id
                            ? { ...conversation, ...base }
                            : conversation,
                        )
                      : [{ id, ...base }, ...item.conversations],
                  }
                : item,
            ),
          };
        }),
      newConversation: () => {
        const projectId = get().ensureProject();
        set((st) => ({
          projects: st.projects.map((item) =>
            item.id === projectId
              ? { ...item, currentConversationId: null }
              : item,
          ),
        }));
      },
      switchConversation: (id) =>
        set((st) => ({
          projects: mapCurrentProject(st, (project) =>
            project.conversations.some((conversation) => conversation.id === id)
              ? { ...project, currentConversationId: id }
              : project,
          ),
        })),
      deleteConversation: (id) =>
        set((st) => ({
          projects: mapCurrentProject(st, (project) => ({
            ...project,
            updatedAt: Date.now(),
            conversations: project.conversations.filter(
              (conversation) => conversation.id !== id,
            ),
            currentConversationId:
              project.currentConversationId === id
                ? null
                : project.currentConversationId,
          })),
        })),
      loadCurrentProjectPdf: async () => {
        const request = ++pdfLoadRequest;
        const project = currentProject(get());
        const candidates = project
          ? [project.currentPdfId, ...project.pdfs.map((pdf) => pdf.id)].filter(
              (id): id is string => Boolean(id),
            )
          : [];
        const tried = new Set<string>();

        for (const candidateId of candidates) {
          if (tried.has(candidateId)) continue;
          tried.add(candidateId);
          const pdf = project?.pdfs.find((item) => item.id === candidateId);
          if (!pdf) continue;
          let file: File | undefined;
          try {
            file = await loadPdf(pdf.id);
          } catch {
            file = undefined;
          }
          if (request !== pdfLoadRequest) return;
          if (!file) continue;
          const prev = get().fileUrl;
          if (prev) URL.revokeObjectURL(prev);
          set((st) => {
            const cached = st.pdfFullTexts[pdf.id];
            return {
              fileUrl: URL.createObjectURL(file),
              fileName: pdf.name,
              pdfId: pdf.id,
              numPages: 0,
              citations: [],
              pdfFullText: cached ?? null,
              pdfTextStatus: cached ? "ready" : "idle",
              pdfTextProgress: 0,
              projects: mapCurrentProject(st, (current) => ({
                ...current,
                currentPdfId: pdf.id,
              })),
            };
          });
          return;
        }

        if (request !== pdfLoadRequest) return;
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
    }),
    {
      name: "chatpaper",
      version: 2,
      partialize: (s) => ({
        settings: s.settings,
        projects: s.projects,
        currentProjectId: s.currentProjectId,
        pdfColorMode: s.pdfColorMode,
        pdfPinchZoom: s.pdfPinchZoom,
        pdfSidebarOpen: s.pdfSidebarOpen,
        chatOpen: s.chatOpen,
        mode: s.mode,
      }),
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as LegacyPersistedState;
        if (version >= 2 && Array.isArray(p.projects)) {
          return { ...p, ...normalizeProjects(p.projects, p.currentProjectId) };
        }
        return {
          ...p,
          ...migrateLegacyProjects(p.conversations, p.currentId),
        };
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as PersistedStateShape;
        const normalized = normalizeProjects(p.projects, p.currentProjectId);
        return {
          ...current,
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
            openNotebook: {
              ...current.settings.openNotebook,
              ...(p.settings?.openNotebook ?? {}),
            },
            chatAnswerMode: p.settings?.chatAnswerMode ?? current.settings.chatAnswerMode,
          },
          projects: normalized.projects,
          currentProjectId: normalized.currentProjectId,
          pdfColorMode: p.pdfColorMode ?? current.pdfColorMode,
          pdfPinchZoom: p.pdfPinchZoom ?? current.pdfPinchZoom,
          pdfSidebarOpen: p.pdfSidebarOpen ?? current.pdfSidebarOpen,
          chatOpen: p.chatOpen ?? current.chatOpen,
          mode: p.mode ?? current.mode,
        };
      },
      storage: createJSONStorage(() => idbStateStorage),
    },
  ),
);
