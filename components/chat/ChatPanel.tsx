"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import { History, MessageSquareText, Settings, SquarePen } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { type Attachment, AttachmentList } from "@/components/chat/AttachmentList";
import { CitationChips } from "@/components/chat/CitationChips";
import { HistoryDialog } from "@/components/chat/HistoryDialog";
import { SettingsDialog } from "@/components/chat/SettingsDialog";
import { Button } from "@/components/ui/button";
import { PromptBox } from "@/components/ui/chatgpt-prompt-input";
import type { Citation } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

/** 从消息 metadata 取出发送时附带的引用 */
function getMessageCitations(m: UIMessage): Citation[] | undefined {
  return (m.metadata as { citations?: Citation[] } | undefined)?.citations;
}

export function ChatPanel() {
  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const citations = useAppStore((s) => s.citations);
  const clearCitations = useAppStore((s) => s.clearCitations);
  const settings = useAppStore((s) => s.settings);
  const conversations = useAppStore((s) => s.conversations);
  const ensureConversation = useAppStore((s) => s.ensureConversation);
  const upsertCurrent = useAppStore((s) => s.upsertCurrent);
  const newConversation = useAppStore((s) => s.newConversation);
  const switchConversation = useAppStore((s) => s.switchConversation);

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // 每轮对话结束后把消息写入当前会话
  useEffect(() => {
    if (status === "ready" && messages.length > 0) {
      upsertCurrent(messages);
    }
  }, [status, messages, upsertCurrent]);

  const addFiles = (list: FileList) => {
    const next = Array.from(list).map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setAttachments((prev) => [...prev, ...next]);
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

  const handleSend = () => {
    if (!settings.apiKey.trim()) {
      setSettingsOpen(true);
      return;
    }
    const t = text.trim();
    if (!t && citations.length === 0 && attachments.length === 0) return;

    let files: FileList | undefined;
    if (attachments.length > 0) {
      const dt = new DataTransfer();
      for (const a of attachments) dt.items.add(a.file);
      files = dt.files;
    }

    const sentCitations = citations;
    ensureConversation();
    sendMessage(
      {
        text: t || "请结合我提供的图片/引用进行说明。",
        files,
        metadata: sentCitations.length ? { citations: sentCitations } : undefined,
      },
      {
        body: {
          citations: sentCitations,
          provider: settings.provider,
          apiKey: settings.apiKey,
          model: settings.model,
        },
      },
    );
    setText("");
    clearAttachments();
    clearCitations();
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
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* header：与左侧 PDF 工具栏等高（h-12） */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-2">
        <Button className="gap-1.5" onClick={handleNewChat} size="sm" variant="ghost">
          <SquarePen className="size-4" />
          新对话
        </Button>
        <div className="flex items-center gap-0.5">
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

      <Conversation>
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              description="在左侧 PDF 中划选文本作为引用，然后在下方提问。"
              icon={<MessageSquareText className="size-8" />}
              title="开始对话"
            />
          ) : (
            messages.map((m) => {
              const msgCitations = getMessageCitations(m);
              return (
                <Message from={m.role} key={m.id}>
                  <MessageContent>
                    {m.role === "user" && msgCitations?.length ? (
                      <MessageCitations citations={msgCitations} />
                    ) : null}
                    {m.parts.map((part, i) => {
                      if (part.type === "text") {
                        return (
                          <MessageResponse key={`${m.id}-${i}`}>
                            {part.text}
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
                  </MessageContent>
                </Message>
              );
            })
          )}

          {/* 等待首字时的「思考中」动效 */}
          {status === "submitted" ? (
            <Message from="assistant">
              <MessageContent>
                <ThinkingDots />
              </MessageContent>
            </Message>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 px-3 pb-3 pt-1">
        <PromptBox
          header={
            citations.length > 0 || attachments.length > 0 ? (
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
          status={status}
          value={text}
        />
      </div>

      <SettingsDialog onOpenChange={setSettingsOpen} open={settingsOpen} />
      <HistoryDialog
        onOpenChange={setHistoryOpen}
        onSelect={handleSelectConversation}
        open={historyOpen}
      />
    </div>
  );
}

/** 用户气泡里显示这条消息引用了哪些 PDF 片段 */
function MessageCitations({ citations }: { citations: Citation[] }) {
  return (
    <div className="mb-1 flex flex-wrap gap-1">
      {citations.map((c) => (
        <span
          className="inline-flex max-w-[16rem] items-center gap-1 rounded-md border bg-background/60 px-1.5 py-0.5 text-xs"
          key={c.id}
        >
          <span className="shrink-0 rounded bg-primary/10 px-1 font-medium text-primary">
            p.{c.page}
          </span>
          <span className="truncate text-muted-foreground">{c.text}</span>
        </span>
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
