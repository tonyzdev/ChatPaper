"use client";

import { FileText, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

export function HistoryDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const conversations = useAppStore((s) => s.conversations);
  const currentId = useAppStore((s) => s.currentId);
  const deleteConversation = useAppStore((s) => s.deleteConversation);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>对话历史</DialogTitle>
        </DialogHeader>

        <div className="-mx-1 flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto px-1">
          {conversations.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground text-sm">
              暂无历史对话
            </p>
          ) : (
            conversations.map((c) => {
              const pdfTitle =
                c.pdfName?.trim() || (c.pdfId ? "已关联 PDF" : "未关联 PDF");

              return (
                <div
                  className={cn(
                    "group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-accent",
                    c.id === currentId && "bg-accent",
                  )}
                  key={c.id}
                  onClick={() => {
                    onSelect(c.id);
                    onOpenChange(false);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{c.title || "新对话"}</div>
                    <div
                      className="mt-1 flex min-w-0 items-center gap-1 text-muted-foreground text-xs"
                      title={pdfTitle}
                    >
                      <FileText className="size-3 shrink-0" />
                      <span className="truncate">PDF：{pdfTitle}</span>
                    </div>
                    <div className="mt-0.5 text-muted-foreground text-xs">
                      {new Date(c.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    aria-label="删除"
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-destructive group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(c.id);
                    }}
                    type="button"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
