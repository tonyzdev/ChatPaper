"use client";

import { FileText, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  currentProject,
  currentProjectConversations,
  pdfSummary,
  useAppStore,
} from "@/store/useAppStore";

export function HistoryDialog({
  open,
  onOpenChange,
  onSelect,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  /** 删除交给父级处理：删除当前会话时父级还需同步清空聊天区 */
  onDelete: (id: string) => void;
}) {
  const project = useAppStore((s) => currentProject(s));
  const conversations = useAppStore((s) => currentProjectConversations(s));
  const currentId = project?.currentConversationId ?? null;
  const pdfTitle = project ? pdfSummary(project.pdfs) : "未选择项目";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>对话历史</DialogTitle>
          <DialogDescription className="truncate" title={project?.name}>
            {project ? `${project.name} · PDF：${pdfTitle}` : "先创建项目，再开始对话。"}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto px-1">
          {conversations.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground text-sm">
              {project ? "当前项目还没有历史对话" : "暂无项目"}
            </p>
          ) : (
            conversations.map((conversation) => (
              <div
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-accent",
                  conversation.id === currentId && "bg-accent",
                )}
                key={conversation.id}
                onClick={() => {
                  onSelect(conversation.id);
                  onOpenChange(false);
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {conversation.title || "新对话"}
                  </div>
                  <div
                    className="mt-1 flex min-w-0 items-center gap-1 text-muted-foreground text-xs"
                    title={pdfTitle}
                  >
                    <FileText className="size-3 shrink-0" />
                    <span className="truncate">PDF：{pdfTitle}</span>
                  </div>
                  <div className="mt-0.5 text-muted-foreground text-xs">
                    {new Date(conversation.updatedAt).toLocaleString()}
                  </div>
                </div>
                <button
                  aria-label="删除"
                  className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-destructive group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(conversation.id);
                  }}
                  type="button"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
