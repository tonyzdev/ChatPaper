"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import { History, Quote, Settings, SquarePen } from "lucide-react";
import { useEffect, useState } from "react";
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
import { HistoryDialog } from "@/components/chat/HistoryDialog";
import { SettingsDialog } from "@/components/chat/SettingsDialog";
import { Button } from "@/components/ui/button";
import { PromptBox } from "@/components/ui/chatgpt-prompt-input";
import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

function getMessageCitations(m: UIMessage): Citation[] | undefined {
  return (m.metadata as { citations?: Citation[] } | undefined)?.citations;
}

// AI（尤其 DeepSeek）常用 \(...\) / \[...\] 包裹公式，而 Streamdown/KaTeX 只认
// $...$ / $$...$$，这里统一转换，确保公式能渲染。
function normalizeMath(s: string): string {
  return s
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m: string) => `$$${m}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, m: string) => `$${m}$`);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ChatPanel() {
  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const citations = useAppStore((s) => s.citations);
  const addCitation = useAppStore((s) => s.addCitation);
  const clearCitations = useAppStore((s) => s.clearCitations);
  const settings = useAppStore((s) => s.settings);
  const conversations = useAppStore((s) => s.conversations);
  const ensureConversation = useAppStore((s) => s.ensureConversation);
  const upsertCurrent = useAppStore((s) => s.upsertCurrent);
  const newConversation = useAppStore((s) => s.newConversation);
  const switchConversation = useAppStore((s) => s.switchConversation);
  const loadConversationPdf = useAppStore((s) => s.loadConversationPdf);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const pendingTranslate = useAppStore((s) => s.pendingTranslate);
  const setPendingTranslate = useAppStore((s) => s.setPendingTranslate);

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sendTick, setSendTick] = useState(0);
  const [replyQuote, setReplyQuote] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);

  // 每轮对话结束后把消息写入当前会话
  useEffect(() => {
    if (status === "ready" && messages.length > 0) {
      upsertCurrent(messages);
    }
  }, [status, messages, upsertCurrent]);

  // 翻译模式：左侧划选的文本到达后自动翻译
  useEffect(() => {
    if (mode !== "translate" || !pendingTranslate) return;
    const txt = pendingTranslate;
    setPendingTranslate(null);
    if (!settings.apiKey.trim()) {
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
          provider: settings.provider,
          apiKey: settings.apiKey,
          baseURL: settings.baseURL,
          model: settings.model,
          deepseekThinking: settings.deepseekThinking,
        },
      },
    );
    setSendTick((n) => n + 1);
  }, [
    pendingTranslate,
    mode,
    settings,
    ensureConversation,
    sendMessage,
    setPendingTranslate,
  ]);

  // 刷新后恢复上次会话的消息与当时的 PDF
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅挂载时恢复一次
  useEffect(() => {
    const { currentId: cid, conversations: convs } = useAppStore.getState();
    if (!cid) return;
    const conv = convs.find((c) => c.id === cid);
    if (conv) {
      setMessages(conv.messages);
      void loadConversationPdf(conv);
    }
  }, []);

  // 主模型不支持图像（deepseek）且配了视觉模型时，上传/粘贴图片即刻转写
  const needsTranscribe = () =>
    settings.provider === "deepseek" &&
    settings.vision.enabled &&
    settings.vision.apiKey.trim().length > 0;

  const transcribe = async (item: Attachment) => {
    setAttachments((prev) =>
      prev.map((a) =>
        a.url === item.url ? { ...a, status: "transcribing" } : a,
      ),
    );
    try {
      const imageUrl = await fileToDataUrl(item.file);
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, vision: settings.vision }),
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

  const handleSend = () => {
    if (!settings.apiKey.trim()) {
      setSettingsOpen(true);
      return;
    }
    if (transcribing) return; // 图片解析中，先不发送
    const t = text.trim();
    if (!t && !hasExtra) return; // 允许“只发图/只发引用”，但不能全空

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

    const sentCitations = citations;
    ensureConversation();
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
          baseURL: settings.baseURL,
          model: settings.model,
          imageTranscriptions,
          deepseekThinking: settings.deepseekThinking,
        },
      },
    );
    setText("");
    clearAttachments();
    clearCitations();
    setSendTick((n) => n + 1); // 触发滚动到底部
  };

  const handleNewChat = () => {
    newConversation();
    setMessages([]);
    setText("");
    clearAttachments();
    clearCitations();
  };

  const handleSelectConversation = (id: string) => {
    const conv = conversations.find((c) => c.id === id);
    switchConversation(id);
    setMessages(conv?.messages ?? []);
    void loadConversationPdf(conv);
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background">
      {/* header：半透明毛玻璃，消息可滚到其下 */}
      <div className="absolute inset-x-0 top-0 z-10 flex h-12 shrink-0 items-center justify-between bg-background/55 px-2 backdrop-blur-md">
        <Button
          className="pointer-events-auto gap-1.5"
          onClick={handleNewChat}
          size="sm"
          variant="ghost"
        >
          <SquarePen className="size-4" />
          新对话
        </Button>

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
        </div>
      </div>

      {/* 消息区：在 AI 回复里划选可引用 */}
      {/* biome-ignore lint/a11y: 划选监听用于浮钮，非交互控件 */}
      <div className="flex min-h-0 flex-1 flex-col" onMouseUp={handleReplySelect}>
        <Conversation>
          <ConversationContent className="px-5 pt-16">
            <AutoScrollOnSend tick={sendTick} />
            {messages.length === 0
              ? null
              : messages.map((m) => {
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
                              <MessageResponse key={`${m.id}-${i}`}>
                                {normalizeMath(part.text)}
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
                })}

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
        <PromptBox
          disabled={transcribing}
          extraContent={hasExtra}
          header={
            hasExtra ? (
              <div className="flex flex-col gap-2">
                <AttachmentList
                  attachments={attachments}
                  onRemove={removeAttachment}
                />
                {citations.length > 0 ? <CitationChips /> : null}
              </div>
            ) : null
          }
          onAttachFiles={addFiles}
          onStop={stop}
          onSubmit={handleSend}
          onValueChange={setText}
          placeholder="问点什么，或在左侧 PDF 划选文本后引用…"
          showAttachButton={false}
          status={status}
          value={text}
        />
        </div>
      ) : (
        <div className="shrink-0 px-5 pt-2 pb-4 text-center text-muted-foreground text-xs">
          翻译模式：在左侧 PDF 划选文本即可自动翻译
        </div>
      )}

      <SettingsDialog onOpenChange={setSettingsOpen} open={settingsOpen} />
      <HistoryDialog
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

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" />
    </div>
  );
}
