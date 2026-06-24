"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import {
  Download,
  FolderOpen,
  History,
  Minus,
  Quote,
  Settings,
  Sparkles,
  SquarePen,
} from "lucide-react";
import { type ComponentProps, useEffect, useMemo, useRef, useState } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  type Attachment,
  AttachmentList,
} from "@/components/chat/AttachmentList";
import { CitationChips } from "@/components/chat/CitationChips";
import {
  conversationToMarkdown,
  downloadMarkdown,
  safeFileName,
} from "@/lib/exportMarkdown";
import { HistoryDialog } from "@/components/chat/HistoryDialog";
import { ProjectDialog } from "@/components/chat/ProjectDialog";
import { SettingsDialog } from "@/components/chat/SettingsDialog";
import { Button } from "@/components/ui/button";
import { PromptBox } from "@/components/ui/chatgpt-prompt-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { linkifyPageRefs, normalizeMath } from "@/lib/markdown";
import {
  buildOpenNotebookContext,
  type ContextScope,
  syncConversationNoteToOpenNotebook,
  syncProjectToOpenNotebook,
} from "@/lib/openNotebook";
import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  type ChatAnswerMode,
  currentConversation,
  currentProject,
  currentProjectConversations,
  currentProjectPdfs,
  pdfSummary,
  useAppStore,
} from "@/store/useAppStore";

function getMessageCitations(m: UIMessage): Citation[] | undefined {
  return (m.metadata as { citations?: Citation[] } | undefined)?.citations;
}

// 打开论文后的一键提问：降低「面对空对话框不知问什么」的门槛
const QUICK_ACTIONS: { label: string; prompt: string; scope?: ContextScope }[] = [
  {
    label: "总结全文",
    prompt: "请简洁总结这篇论文：研究问题、方法、主要发现与结论。",
  },
  {
    label: "讲讲方法",
    prompt:
      "请详细讲讲这篇论文采用的方法 / 技术路线，说清关键步骤与设计动机。",
  },
  {
    label: "有哪些局限",
    prompt: "这篇论文有哪些局限、不足或值得商榷之处？",
  },
  {
    label: "相关工作对比",
    prompt: "请基于当前项目里的文献，比较这篇论文与相关工作的区别与贡献。",
    scope: "project",
  },
];

type AgentStreamEvent =
  | { type: "status"; message: string }
  | { type: "text_delta"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ChatPanel({ onCollapse }: { onCollapse?: () => void } = {}) {
  const citations = useAppStore((s) => s.citations);
  const addCitation = useAppStore((s) => s.addCitation);
  const clearCitations = useAppStore((s) => s.clearCitations);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const contextScope = settings.contextScope ?? "current-pdf";
  const chatAnswerMode = settings.chatAnswerMode ?? "direct";
  const project = useAppStore((s) => currentProject(s));
  const conversations = useAppStore((s) => currentProjectConversations(s));
  const ensureConversation = useAppStore((s) => s.ensureConversation);
  const upsertCurrent = useAppStore((s) => s.upsertCurrent);
  const createProject = useAppStore((s) => s.createProject);
  const newConversation = useAppStore((s) => s.newConversation);
  const switchProject = useAppStore((s) => s.switchProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const switchConversation = useAppStore((s) => s.switchConversation);
  const deleteConversation = useAppStore((s) => s.deleteConversation);
  const loadCurrentProjectPdf = useAppStore((s) => s.loadCurrentProjectPdf);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const setPendingTranslate = useAppStore((s) => s.setPendingTranslate);
  const pdfId = useAppStore((s) => s.pdfId);
  const pdfFullText = useAppStore((s) => s.pdfFullText);
  const projectPdfs = useAppStore((s) => currentProjectPdfs(s));
  const pdfFullTexts = useAppStore((s) => s.pdfFullTexts);
  const fileName = useAppStore((s) => s.fileName);
  const openPdf = useAppStore((s) => s.openPdf);
  const pendingPdf = useAppStore((s) => s.pendingPdf);
  const setPendingPdf = useAppStore((s) => s.setPendingPdf);
  const jumpToPage = useAppStore((s) => s.jumpToPage);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [sendTick, setSendTick] = useState(0);
  const [preparingContext, setPreparingContext] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [agentStreaming, setAgentStreaming] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const agentAbortRef = useRef<AbortController | null>(null);
  const [replyQuote, setReplyQuote] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);
  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    onFinish: ({ messages: finishedMessages }) => {
      void syncCurrentConversationNote(finishedMessages).catch((error) => {
        setSyncError(error instanceof Error ? error.message : String(error));
      });
    },
  });

  function projectSyncSnapshot(currentMessages?: UIMessage[]) {
    const state = useAppStore.getState();
    const activeProject = currentProject(state);
    if (!activeProject) return null;

    const conversationsToSync = activeProject.conversations.map((conversation) =>
      conversation.id === activeProject.currentConversationId && currentMessages
        ? { ...conversation, messages: currentMessages }
        : conversation,
    );

    const currentPdfId = activeProject.pdfs.some((pdf) => pdf.id === state.pdfId)
      ? state.pdfId
      : activeProject.currentPdfId;

    return {
      project: activeProject,
      currentPdfId,
      conversationsToSync,
      documentNames: activeProject.pdfs.map((pdf) => pdf.name),
      documentsToSync: activeProject.pdfs
        .map((pdf) => ({
          id: pdf.id,
          name: pdf.name,
          text: state.pdfFullTexts[pdf.id] ?? "",
        }))
        .filter((document) => document.text.trim().length > 0),
    };
  }

  async function prepareOpenNotebookContext(scope: ContextScope) {
    if (settings.contextEngine !== "open-notebook") return undefined;
    if (!settings.openNotebook.baseUrl.trim()) {
      setSettingsOpen(true);
      throw new Error("已切换到 Open Notebook 引擎，但还没填写 Open Notebook 地址");
    }

    const snapshot = projectSyncSnapshot();
    if (!snapshot) return undefined;

    const { notebookId } = await syncProjectToOpenNotebook({
      connection: settings.openNotebook,
      project: {
        id: snapshot.project.id,
        name: snapshot.project.name,
      },
      documents: snapshot.documentsToSync,
      conversations: snapshot.conversationsToSync,
    });

    return (
      (await buildOpenNotebookContext({
        connection: settings.openNotebook,
        notebookId,
        projectName: snapshot.project.name,
        currentConversationId: snapshot.project.currentConversationId,
        currentPdfId: snapshot.currentPdfId,
        scope,
      })) ?? undefined
    );
  }

  async function syncCurrentConversationNote(currentMessages: UIMessage[]) {
    if (mode !== "chat" || settings.contextEngine !== "open-notebook") return;
    if (!settings.openNotebook.baseUrl.trim()) return;

    const snapshot = projectSyncSnapshot(currentMessages);
    if (!snapshot) return;

    const conversation = snapshot.conversationsToSync.find(
      (item) => item.id === snapshot.project.currentConversationId,
    );
    if (!conversation || conversation.messages.length === 0) return;

    await syncConversationNoteToOpenNotebook({
      connection: settings.openNotebook,
      project: {
        id: snapshot.project.id,
        name: snapshot.project.name,
      },
      documentNames: snapshot.documentNames,
      conversation,
    });
  }
  // 每轮对话结束后把消息写入当前会话
  useEffect(() => {
    if (status === "ready" && messages.length > 0) {
      upsertCurrent(messages);
    }
  }, [status, messages, upsertCurrent]);

  // 翻译模式：左侧划选的文本通过 store 传来。用订阅把它当作“事件”处理 ——
  // 在订阅回调里 setState（等同事件处理器），避免在 effect 体内同步 setState 触发级联渲染。
  useEffect(() => {
    return useAppStore.subscribe((state, prev) => {
      const txt = state.pendingTranslate;
      if (!txt || txt === prev.pendingTranslate) return;
      if (state.mode !== "translate") return;
      setPendingTranslate(null);
      const translationSettings = settings.translation.useMainModel
        ? {
            provider: settings.provider,
            apiKey: settings.apiKey,
            baseURL: settings.baseURL,
            model: settings.model,
            deepseekThinking: settings.deepseekThinking,
          }
        : {
            provider: settings.translation.provider,
            apiKey:
              settings.translation.apiKey.trim() ||
              (settings.translation.provider === settings.provider
                ? settings.apiKey
                : ""),
            baseURL:
              settings.translation.baseURL.trim() ||
              (settings.translation.provider === settings.provider
                ? settings.baseURL
                : ""),
            model: settings.translation.model,
            deepseekThinking: settings.translation.deepseekThinking,
          };
      if (!translationSettings.apiKey.trim() && !settings.accessCode.trim()) {
        setSettingsOpen(true);
        return;
      }
      ensureConversation();
      sendMessage(
        {
          text: `请翻译下面的文字（中文↔英文互译），只输出译文，不要任何解释：\n\n${txt}`,
        },
        {
          body: {
            provider: translationSettings.provider,
            apiKey: translationSettings.apiKey,
            accessCode: settings.accessCode,
            baseURL: translationSettings.baseURL,
            model: translationSettings.model,
            deepseekThinking:
              translationSettings.provider === "deepseek"
                ? translationSettings.deepseekThinking
                : false,
          },
        },
      );
      setSendTick((n) => n + 1);
    });
  }, [settings, ensureConversation, sendMessage, setPendingTranslate]);

  // 刷新后恢复上次会话的消息与当时的 PDF。
  // persist 存储是异步的（IndexedDB），挂载瞬间 state 可能还是默认值，
  // 所以恢复要等水合完成（已完成则立即执行）。
  useEffect(() => {
    const restore = () => {
      const conversation = currentConversation(useAppStore.getState());
      if (conversation) {
        setMessages(conversation.messages);
      } else {
        setMessages([]);
      }
      void loadCurrentProjectPdf();
    };
    if (useAppStore.persist.hasHydrated()) {
      restore();
      return;
    }
    return useAppStore.persist.onFinishHydration(restore);
    // 仅挂载时恢复一次，故意只依赖空数组（报错锚在依赖数组行，注释须紧贴）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主模型不支持图像（deepseek）且配了视觉模型时，上传/粘贴图片即刻转写
  const needsTranscribe = () =>
    settings.provider === "deepseek" &&
    ((settings.vision.enabled && settings.vision.apiKey.trim().length > 0) ||
      (settings.ocr.enabled && settings.ocr.apiKey.trim().length > 0));

  const transcribe = async (item: Attachment) => {
    setAttachments((prev) =>
      prev.map((a) =>
        a.url === item.url ? { ...a, status: "transcribing" } : a,
      ),
    );
    try {
      const imageUrl = await fileToDataUrl(item.file);
      const useOcr =
        settings.ocr.enabled && settings.ocr.apiKey.trim().length > 0;
      const res = await fetch(useOcr ? "/api/ocr" : "/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          useOcr
            ? { imageUrl, ocr: settings.ocr }
            : { imageUrl, vision: settings.vision },
        ),
      });
      const data = (await res.json()) as { ok: boolean; text?: string };
      setAttachments((prev) =>
        prev.map((a) =>
          a.url === item.url
            ? data.ok
              ? { ...a, status: "ready", transcription: data.text }
              : { ...a, status: "error" }
            : a,
        ),
      );
    } catch {
      setAttachments((prev) =>
        prev.map((a) => (a.url === item.url ? { ...a, status: "error" } : a)),
      );
    }
  };

  const addFiles = (list: FileList) => {
    const next: Attachment[] = Array.from(list).map((file) => ({
      file,
      url: URL.createObjectURL(file),
      status: "ready",
    }));
    setAttachments((prev) => [...prev, ...next]);
    if (needsTranscribe()) {
      for (const item of next) {
        if (item.file.type.startsWith("image/")) void transcribe(item);
      }
    }
  };
  const removeAttachment = (index: number) => {
    setAttachments((prev) => {
      const t = prev[index];
      if (t) URL.revokeObjectURL(t.url);
      return prev.filter((_, i) => i !== index);
    });
  };
  const clearAttachments = () => {
    setAttachments((prev) => {
      for (const a of prev) URL.revokeObjectURL(a.url);
      return [];
    });
  };

  const transcribing = attachments.some((a) => a.status === "transcribing");
  const preparing = transcribing || preparingContext;
  const busy = preparing || agentStreaming;
  const hasExtra = citations.length > 0 || attachments.length > 0;

  // 在 AI 回复里划选文本 → 浮钮「引用」
  const handleReplySelect = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setReplyQuote(null);
      return;
    }
    const t = sel.toString().trim();
    const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (!t || !range) {
      setReplyQuote(null);
      return;
    }
    const node = range.commonAncestorContainer;
    const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
    // 仅当选区落在 AI 回复（assistant 气泡）内才提供引用
    if (!el?.closest(".is-assistant")) {
      setReplyQuote(null);
      return;
    }
    const r = range.getBoundingClientRect();
    setReplyQuote({ text: t, top: r.top - 6, left: r.left + r.width / 2 });
  };
  const confirmReplyQuote = () => {
    if (!replyQuote) return;
    addCitation({ text: replyQuote.text, source: "AI 回复" });
    window.getSelection()?.removeAllRanges();
    setReplyQuote(null);
  };

  const stopAgentResearch = () => {
    agentAbortRef.current?.abort();
    agentAbortRef.current = null;
    setAgentStreaming(false);
    setAgentStatus(null);
  };

  async function readAgentStream(
    response: Response,
    onEvent: (event: AgentStreamEvent) => void,
  ) {
    if (!response.body) throw new Error("Agent 没有返回可读取的响应流");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        onEvent(JSON.parse(trimmed) as AgentStreamEvent);
      }
    }

    const tail = buffer.trim();
    if (tail) onEvent(JSON.parse(tail) as AgentStreamEvent);
  }

  const sendAgentMessage = async (
    prompt: string,
    scope: ContextScope,
    sentCitations: Citation[] = [],
  ) => {
    const requestDocuments = documentsForScope(scope);
    let openNotebookContext: string | undefined;
    if (settings.contextEngine === "open-notebook") {
      setPreparingContext(true);
      try {
        openNotebookContext = await prepareOpenNotebookContext(scope);
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        setPreparingContext(false);
      }
    }

    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: prompt }],
      metadata: sentCitations.length ? { citations: sentCitations } : undefined,
    };
    const assistantMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [{ type: "text", text: "" }],
    };

    let assistantText = "";
    let finalMessages: UIMessage[] = [...messages, userMessage, assistantMessage];
    setMessages(finalMessages);
    setText("");
    clearAttachments();
    clearCitations();
    setSendTick((n) => n + 1);
    setAgentStreaming(true);
    setAgentStatus("Agent 正在准备项目材料…");

    const controller = new AbortController();
    agentAbortRef.current = controller;
    try {
      const response = await fetch("/api/agent/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          messages,
          citations: sentCitations,
          provider: settings.provider,
          apiKey: settings.apiKey,
          accessCode: settings.accessCode,
          baseURL: settings.baseURL,
          model: settings.model,
          deepseekThinking: settings.deepseekThinking,
          contextScope: scope,
          openNotebookContext,
          documents: requestDocuments,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || `Agent 请求失败（${response.status}）`);
      }

      await readAgentStream(response, (event) => {
        if (event.type === "status") {
          setAgentStatus(event.message);
          return;
        }
        if (event.type === "text_delta") {
          assistantText += event.text;
          finalMessages = [
            ...messages,
            userMessage,
            {
              ...assistantMessage,
              parts: [{ type: "text", text: assistantText }],
            },
          ];
          setMessages(finalMessages);
          return;
        }
        if (event.type === "error") throw new Error(event.message);
      });

      if (assistantText.trim().length === 0) {
        finalMessages = [
          ...messages,
          userMessage,
          {
            ...assistantMessage,
            parts: [{ type: "text", text: "Agent 没有返回内容。" }],
          },
        ];
        setMessages(finalMessages);
      }
      upsertCurrent(finalMessages);
      void syncCurrentConversationNote(finalMessages).catch((error) => {
        setSyncError(error instanceof Error ? error.message : String(error));
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setSyncError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (agentAbortRef.current === controller) agentAbortRef.current = null;
      setAgentStreaming(false);
      setAgentStatus(null);
    }
  };

  const handleSend = async () => {
    // 没填 Key 也没填站点口令 → 引导打开设置（填口令可用站点内置模型）
    if (!settings.apiKey.trim() && !settings.accessCode.trim()) {
      setSettingsOpen(true);
      return;
    }
    if (busy) return;
    const t = text.trim();
    if (!t && !hasExtra) return; // 允许“只发图/只发引用”，但不能全空

    const sentCitations = citations;
    ensureConversation();
    setSyncError(null);

    const scope = contextScope;
    if (chatAnswerMode === "agent") {
      if (attachments.length > 0) {
        setSyncError("Agent 研究暂不支持图片附件；请移除附件，或切回「快速回答」。");
        return;
      }
      await sendAgentMessage(t || "请结合我提供的引用进行说明。", scope, sentCitations);
      return;
    }

    let files: FileList | undefined;
    if (attachments.length > 0) {
      const dt = new DataTransfer();
      for (const a of attachments) dt.items.add(a.file);
      files = dt.files;
    }
    // 前端已转写好的图片文本，按图片顺序传给后端（deepseek 用）
    const imageTranscriptions = attachments
      .filter((a) => a.file.type.startsWith("image/"))
      .map((a) => a.transcription ?? null);

    const requestDocuments = documentsForScope(scope);
    let openNotebookContext: string | undefined;
    if (settings.contextEngine === "open-notebook") {
      setPreparingContext(true);
      try {
        openNotebookContext = await prepareOpenNotebookContext(scope);
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        setPreparingContext(false);
      }
    }

    sendMessage(
      {
        text: t || "请结合我提供的图片/引用进行说明。",
        files,
        metadata: sentCitations.length
          ? { citations: sentCitations }
          : undefined,
      },
      {
        body: {
          citations: sentCitations,
          provider: settings.provider,
          apiKey: settings.apiKey,
          accessCode: settings.accessCode,
          baseURL: settings.baseURL,
          model: settings.model,
          imageTranscriptions,
          deepseekThinking: settings.deepseekThinking,
          contextEngine: settings.contextEngine,
          contextScope: scope,
          openNotebookContext,
          documents:
            settings.contextEngine === "builtin" && requestDocuments.length > 0
              ? requestDocuments
              : undefined,
        },
      },
    );
    setText("");
    clearAttachments();
    clearCitations();
    setSendTick((n) => n + 1); // 触发滚动到底部
  };

  // 快捷操作：直接发送预设问题（结合项目上下文）
  const runQuickAction = async (prompt: string, scopeOverride?: ContextScope) => {
    if (!settings.apiKey.trim() && !settings.accessCode.trim()) {
      setSettingsOpen(true);
      return;
    }
    if (busy) return;
    ensureConversation();
    setSyncError(null);

    const scope = scopeOverride ?? contextScope;
    if (chatAnswerMode === "agent") {
      await sendAgentMessage(prompt, scope);
      return;
    }

    const requestDocuments = documentsForScope(scope);
    let openNotebookContext: string | undefined;
    if (settings.contextEngine === "open-notebook") {
      setPreparingContext(true);
      try {
        openNotebookContext = await prepareOpenNotebookContext(scope);
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        setPreparingContext(false);
      }
    }

    sendMessage(
      { text: prompt },
      {
        body: {
          provider: settings.provider,
          apiKey: settings.apiKey,
          accessCode: settings.accessCode,
          baseURL: settings.baseURL,
          model: settings.model,
          deepseekThinking: settings.deepseekThinking,
          contextEngine: settings.contextEngine,
          contextScope: scope,
          openNotebookContext,
          documents:
            settings.contextEngine === "builtin" && requestDocuments.length > 0
              ? requestDocuments
              : undefined,
        },
      },
    );
    setSendTick((n) => n + 1);
  };

  const handleNewChat = () => {
    stop(); // 流式中开新对话：先停掉，否则后续 chunk 会写进新会话
    stopAgentResearch();
    newConversation();
    setMessages([]);
    setText("");
    clearAttachments();
    clearCitations();
  };

  const handleSelectProject = (id: string) => {
    stop();
    stopAgentResearch();
    switchProject(id);
    const conversation = currentConversation(useAppStore.getState());
    setMessages(conversation?.messages ?? []);
    setText("");
    clearAttachments();
    clearCitations();
    void loadCurrentProjectPdf();
  };

  const handleCreateProject = (name?: string) => {
    stop();
    stopAgentResearch();
    createProject(name);
    setMessages([]);
    setText("");
    clearAttachments();
    clearCitations();
    void loadCurrentProjectPdf();
  };

  const handleDeleteProject = (id: string) => {
    const wasCurrent = project?.id === id;
    deleteProject(id);
    if (!wasCurrent) return;
    stop();
    stopAgentResearch();
    const conversation = currentConversation(useAppStore.getState());
    setMessages(conversation?.messages ?? []);
    setText("");
    clearAttachments();
    clearCitations();
    void loadCurrentProjectPdf();
  };

  const handleSelectConversation = (id: string) => {
    stop(); // 流式中切换会话：先停掉，否则旧会话的回复会混进切换后的会话
    stopAgentResearch();
    const conversation = conversations.find((item) => item.id === id);
    switchConversation(id);
    setMessages(conversation?.messages ?? []);
  };

  const handleDeleteConversation = (id: string) => {
    const wasCurrent = currentConversation(useAppStore.getState())?.id === id;
    deleteConversation(id);
    if (!wasCurrent) return;
    stop();
    stopAgentResearch();
    setMessages([]);
  };

  const handleExport = () => {
    if (messages.length === 0) return;
    const conversation = currentConversation(useAppStore.getState());
    const title = conversation?.title || "ChatPaper 对话";
    const md = conversationToMarkdown(messages, {
      title,
      pdfName: projectPdfs.length > 0 ? pdfSummary(projectPdfs) : undefined,
    });
    downloadMarkdown(safeFileName(title), md);
  };

  // 把 AI 回答里的页码引用链接（#cp-page-N）渲染成按钮，点击通知阅读器跳转高亮；
  // 其他链接照常新开页。引用稳定即可（MessageResponse 的 memo 只比较 children）。
  const markdownComponents = useMemo(
    () => ({
      a: ({ href, children }: ComponentProps<"a">) => {
        if (href?.startsWith("#cp-page-")) {
          // 形如 #cp-page-3 或 #cp-page-3?q=<encoded 原文片段>
          const [pageStr, encoded] = href
            .slice("#cp-page-".length)
            .split("?q=");
          const page = Number(pageStr);
          let quote: string | undefined;
          if (encoded) {
            try {
              quote = decodeURIComponent(encoded);
            } catch {
              quote = undefined;
            }
          }
          return (
            <button
              className="mx-0.5 rounded bg-primary/10 px-1 text-primary text-xs hover:bg-primary/20"
              onClick={() => {
                if (page > 0) jumpToPage(page, quote);
              }}
              title={quote ? `定位：${quote}` : undefined}
              type="button"
            >
              {children}
            </button>
          );
        }
        return (
          <a href={href} rel="noreferrer" target="_blank">
            {children}
          </a>
        );
      },
    }),
    [jumpToPage],
  );

  // 已解析全文的各篇 PDF，按回答范围注入 system 作为上下文
  const documents = projectPdfs
    .map((p) => ({
      id: p.id,
      name: p.name,
      text:
        p.id === pdfId
          ? (pdfFullText ?? pdfFullTexts[p.id] ?? "")
          : (pdfFullTexts[p.id] ?? ""),
    }))
    .filter((d) => d.text.trim());
  const documentsForScope = (scope: ContextScope) =>
    (scope === "current-pdf"
      ? documents.filter((document) => document.id === pdfId)
      : documents
    ).map(({ id, name, text }) => ({ id, name, text }));
  const scopeDetail =
    contextScope === "current-pdf"
      ? fileName
        ? documents.some((document) => document.id === pdfId)
          ? fileName
          : "当前 PDF 尚未解析全文"
        : "未打开 PDF"
      : projectPdfs.length > 0
        ? `${documents.length}/${projectPdfs.length} 篇已解析`
        : "项目中暂无 PDF";

  // 仅当前翻译模式：数据全保留，显示层只渲染最新一条译文对（不删历史）
  const displayMessages =
    mode === "translate" && !settings.translation.keepHistory
      ? messages.slice(-2)
      : messages;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-transparent">
      {/* header：半透明毛玻璃，消息可滚到其下 */}
      <div className="absolute inset-x-0 top-0 z-10 flex h-12 shrink-0 items-center justify-between bg-background/55 px-2 backdrop-blur-md">
        <div className="pointer-events-auto flex min-w-0 items-center gap-1">
          <Button
            className="max-w-40 gap-1.5"
            onClick={() => setProjectOpen(true)}
            size="sm"
            title={project?.name ?? "选择项目"}
            variant="outline"
          >
            <FolderOpen className="size-3.5" />
            <span className="truncate">{project?.name ?? "项目"}</span>
          </Button>
          <Button
            className="gap-1.5"
            onClick={handleNewChat}
            size="sm"
            variant="ghost"
          >
            <SquarePen className="size-4" />
            新对话
          </Button>
        </div>

        <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg bg-muted/80 p-0.5 backdrop-blur-sm">
          <button
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors",
              mode === "chat"
                ? "bg-background text-foreground shadow-sm dark:bg-foreground dark:text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setMode("chat")}
            type="button"
          >
            对话
          </button>
          <button
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors",
              mode === "translate"
                ? "bg-background text-foreground shadow-sm dark:bg-foreground dark:text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setMode("translate")}
            type="button"
          >
            翻译
          </button>
        </div>

        <div className="pointer-events-auto flex items-center gap-0.5">
          {messages.length > 0 ? (
            <Button
              aria-label="导出为 Markdown"
              onClick={handleExport}
              size="icon-sm"
              title="导出当前对话为 Markdown"
              variant="ghost"
            >
              <Download className="size-4" />
            </Button>
          ) : null}
          <Button
            aria-label="对话历史"
            onClick={() => setHistoryOpen(true)}
            size="icon-sm"
            variant="ghost"
          >
            <History className="size-4" />
          </Button>
          <Button
            aria-label="设置"
            onClick={() => setSettingsOpen(true)}
            size="icon-sm"
            variant="ghost"
          >
            <Settings className="size-4" />
          </Button>
          {onCollapse ? (
            <Button
              aria-label="收起对话"
              onClick={onCollapse}
              size="icon-sm"
              title="收起到右下角"
              variant="ghost"
            >
              <Minus className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* 消息区：在 AI 回复里划选可引用（onMouseUp 仅做划选监听，非交互控件） */}
      <div className="flex min-h-0 flex-1 flex-col" onMouseUp={handleReplySelect}>
        <Conversation>
          <ConversationContent className="px-5 pt-16">
            <AutoScrollOnSend tick={sendTick} />
            {displayMessages.length === 0 ? (
              fileName ? (
                <QuickActions
                  hasFullText={Boolean(pdfFullText)}
                  onPick={runQuickAction}
                  pdfName={fileName}
                />
              ) : null
            ) : (
              displayMessages.map((m) => {
                const msgCitations = getMessageCitations(m);
                return (
                  <Message from={m.role} key={m.id}>
                    <MessageContent>
                      {m.role === "user" && msgCitations?.length ? (
                        <MessageCitations citations={msgCitations} />
                      ) : null}
                      {m.parts.map((part, i) => {
                        if (part.type === "reasoning") {
                          return (
                            <ReasoningBlock
                              key={`${m.id}-${i}`}
                              streaming={
                                status === "streaming" &&
                                m === messages.at(-1)
                              }
                              text={part.text}
                            />
                          );
                        }
                        if (part.type === "text") {
                          return (
                            <MessageResponse
                              components={markdownComponents}
                              key={`${m.id}-${i}`}
                            >
                              {linkifyPageRefs(normalizeMath(part.text))}
                            </MessageResponse>
                          );
                        }
                        if (
                          part.type === "file" &&
                          part.mediaType?.startsWith("image/")
                        ) {
                          return (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt={part.filename ?? "附件图片"}
                              className="max-w-xs rounded-lg border"
                              key={`${m.id}-${i}`}
                              src={part.url}
                            />
                          );
                        }
                        return null;
                      })}
                      {/* 流式开始但首字未到时，气泡内继续显示 loading，避免空档 */}
                      {m.role === "assistant" &&
                      !m.parts.some(
                        (p) =>
                          (p.type === "text" && p.text.length > 0) ||
                          (p.type === "reasoning" && p.text.length > 0) ||
                          p.type === "file",
                      ) ? (
                        <ThinkingDots />
                      ) : null}
                    </MessageContent>
                  </Message>
                );
              })
            )}

            {status === "submitted" && messages.at(-1)?.role !== "assistant" ? (
              <Message from="assistant">
                <MessageContent>
                  <ThinkingDots />
                </MessageContent>
              </Message>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      {mode === "chat" ? (
        <div className="shrink-0 px-5 pt-1 pb-3">
          {preparingContext ? (
            <p className="mb-2 text-muted-foreground text-xs">
              正在同步 Open Notebook {contextScope === "current-pdf" ? "当前 PDF" : "项目"}上下文…
            </p>
          ) : null}
          {agentStatus ? (
            <p className="mb-2 text-muted-foreground text-xs">{agentStatus}</p>
          ) : null}
          {syncError ? (
            <p className="mb-2 text-destructive text-xs">{syncError}</p>
          ) : null}
          <PromptBox
            disabled={preparing}
            extraContent={hasExtra}
            header={
              <div className="flex flex-col gap-2">
                <ContextScopeSelector
                  detail={scopeDetail}
                  disabled={busy}
                  onChange={(next) => setSettings({ contextScope: next })}
                  value={contextScope}
                />
                <AnswerModeSelector
                  disabled={busy}
                  onChange={(next) => setSettings({ chatAnswerMode: next })}
                  value={chatAnswerMode}
                />
                {hasExtra ? (
                  <div className="flex flex-col gap-2">
                    <AttachmentList
                      attachments={attachments}
                      onRemove={removeAttachment}
                    />
                    {citations.length > 0 ? <CitationChips /> : null}
                  </div>
                ) : null}
              </div>
            }
            onAttachFiles={addFiles}
            onStop={agentStreaming ? stopAgentResearch : stop}
            onSubmit={handleSend}
            onValueChange={setText}
            placeholder="问点什么，或在左侧 PDF 划选文本后引用…"
            showAttachButton={false}
            status={agentStreaming ? "streaming" : status}
            value={text}
          />
        </div>
      ) : (
        <div className="flex shrink-0 flex-col items-center gap-2 px-5 pt-2 pb-4 text-muted-foreground text-xs">
          <span>翻译模式：在左侧 PDF 划选文本即可自动翻译</span>
          <label className="flex cursor-pointer select-none items-center gap-1.5">
            <Switch
              checked={settings.translation.keepHistory}
              onCheckedChange={(c) =>
                setSettings({
                  translation: { ...settings.translation, keepHistory: c },
                })
              }
              size="sm"
            />
            <span>保留翻译历史（关闭则只显示当前一条）</span>
          </label>
        </div>
      )}

      {/* 上传新 PDF 撞上「当前项目已在进行」时，让用户选开新项目还是加到当前 */}
      <Dialog
        onOpenChange={(o) => {
          if (!o) setPendingPdf(null);
        }}
        open={Boolean(pendingPdf)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>当前项目已在进行中</DialogTitle>
            <DialogDescription className="truncate" title={pendingPdf?.name}>
              新 PDF「{pendingPdf?.name}」要怎么处理？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              onClick={() => {
                const file = pendingPdf;
                setPendingPdf(null);
                if (file) openPdf(file);
              }}
              variant="outline"
            >
              加到当前项目
            </Button>
            <Button
              onClick={() => {
                const file = pendingPdf;
                setPendingPdf(null);
                stop();
                createProject(file?.name);
                setMessages([]);
                setText("");
                clearAttachments();
                clearCitations();
                if (file) openPdf(file);
              }}
            >
              开新项目
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProjectDialog
        onCreate={handleCreateProject}
        onDelete={handleDeleteProject}
        onOpenChange={setProjectOpen}
        onSelect={handleSelectProject}
        open={projectOpen}
      />
      <SettingsDialog onOpenChange={setSettingsOpen} open={settingsOpen} />
      <HistoryDialog
        onDelete={handleDeleteConversation}
        onOpenChange={setHistoryOpen}
        onSelect={handleSelectConversation}
        open={historyOpen}
      />

      {/* 划选 AI 回复后的「引用」浮钮 */}
      {replyQuote ? (
        <div
          className="-translate-x-1/2 -translate-y-full fixed z-50"
          style={{ top: replyQuote.top, left: replyQuote.left }}
        >
          <Button
            className="shadow-lg"
            onClick={confirmReplyQuote}
            onMouseDown={(e) => e.preventDefault()}
            size="sm"
          >
            <Quote className="size-3.5" />
            引用
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** 在 Conversation 内部：每次发送（tick 变化）强制滚到底 */
function AutoScrollOnSend({ tick }: { tick: number }) {
  const { scrollToBottom } = useStickToBottomContext();
  useEffect(() => {
    if (tick > 0) scrollToBottom();
  }, [tick, scrollToBottom]);
  return null;
}

/** DeepSeek 思考过程（可折叠） */
function ReasoningBlock({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  return (
    <details
      className="mb-2 rounded-lg border bg-muted/40 px-3 py-2"
      open={streaming}
    >
      <summary className="cursor-pointer select-none font-medium text-muted-foreground text-xs">
        💭 思考过程
      </summary>
      <div className="mt-2 whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed">
        {text}
      </div>
    </details>
  );
}

/** 用户气泡里显示这条消息引用了哪些来源 */
function MessageCitations({ citations }: { citations: Citation[] }) {
  return (
    <div className="mb-1.5 flex flex-col gap-1">
      {citations.map((c) => (
        <div
          className="flex items-center gap-2 rounded-r border-primary/40 border-l-2 bg-background/50 py-1 pr-2 pl-2 text-xs"
          key={c.id}
        >
          <span className="line-clamp-1 flex-1 text-muted-foreground">
            {c.text}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground/60">
            {c.page != null ? `第 ${c.page} 页` : c.source}
          </span>
        </div>
      ))}
    </div>
  );
}

const CONTEXT_SCOPE_OPTIONS: { value: ContextScope; label: string }[] = [
  { value: "current-pdf", label: "当前 PDF" },
  { value: "project", label: "全项目" },
];

function ContextScopeSelector({
  value,
  detail,
  disabled,
  onChange,
}: {
  value: ContextScope;
  detail: string;
  disabled?: boolean;
  onChange: (value: ContextScope) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">范围</span>
      <div className="flex shrink-0 rounded-full bg-muted p-0.5">
        {CONTEXT_SCOPE_OPTIONS.map((option) => (
          <button
            aria-pressed={value === option.value}
            className={cn(
              "rounded-full px-2.5 py-1 font-medium transition-colors",
              value === option.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            disabled={disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className="min-w-0 truncate text-muted-foreground/70" title={detail}>
        {detail}
      </span>
    </div>
  );
}

const ANSWER_MODE_OPTIONS: { value: ChatAnswerMode; label: string }[] = [
  { value: "direct", label: "快速回答" },
  { value: "agent", label: "Agent 研究" },
];

function AnswerModeSelector({
  value,
  disabled,
  onChange,
}: {
  value: ChatAnswerMode;
  disabled?: boolean;
  onChange: (value: ChatAnswerMode) => void;
}) {
  const detail =
    value === "agent" ? "先检索项目材料再作答" : "直接用当前上下文生成";

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">模式</span>
      <div className="flex shrink-0 rounded-full bg-muted p-0.5">
        {ANSWER_MODE_OPTIONS.map((option) => (
          <button
            aria-pressed={value === option.value}
            className={cn(
              "rounded-full px-2.5 py-1 font-medium transition-colors",
              value === option.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            disabled={disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className="min-w-0 truncate text-muted-foreground/70" title={detail}>
        {detail}
      </span>
    </div>
  );
}

/** 空会话 + 已加载 PDF 时的一键提问入口 */
function QuickActions({
  onPick,
  hasFullText,
  pdfName,
}: {
  onPick: (prompt: string, scope?: ContextScope) => void;
  hasFullText: boolean;
  pdfName: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 pt-12 text-center">
      <Sparkles className="size-7 text-muted-foreground/60" />
      {pdfName ? (
        <p className="max-w-xs truncate font-medium text-sm" title={pdfName}>
          {pdfName}
        </p>
      ) : null}
      <p className="text-muted-foreground text-sm">
        从一个问题开始，或在下方直接输入
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {QUICK_ACTIONS.map((a) => (
          <Button
            key={a.label}
            onClick={() => onPick(a.prompt, a.scope)}
            size="sm"
            variant="outline"
          >
            {a.label}
          </Button>
        ))}
      </div>
      {hasFullText ? null : (
        <p className="text-[11px] text-muted-foreground/70">
          提示：在左侧工具栏「解析全文」后，回答会更准确
        </p>
      )}
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" />
    </div>
  );
}
