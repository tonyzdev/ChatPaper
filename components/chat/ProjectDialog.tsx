"use client";

import { FileText, FolderOpen, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

export function ProjectDialog({
  open,
  onOpenChange,
  onSelect,
  onCreate,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onCreate: (name?: string) => void;
  onDelete: (id: string) => void;
}) {
  const projects = useAppStore((s) => s.projects);
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const [name, setName] = useState("");


  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setName("");
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>项目</DialogTitle>
          <DialogDescription>每个项目独立保存多段对话和多篇 PDF。</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex max-h-[46vh] flex-col gap-0.5 overflow-y-auto px-1">
          {projects.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground text-sm">
              还没有项目，先建一个再开始聊。
            </p>
          ) : (
            projects.map((project) => (
              <div
                className={cn(
                  "group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-accent",
                  project.id === currentProjectId && "bg-accent",
                )}
                key={project.id}
                onClick={() => {
                  onSelect(project.id);
                  setName("");
                  onOpenChange(false);
                }}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FolderOpen className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{project.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="size-3" />
                      {project.conversations.length} 段对话
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <FileText className="size-3" />
                      {project.pdfs.length} 篇 PDF
                    </span>
                  </div>
                  <div className="mt-0.5 text-muted-foreground text-xs">
                    {new Date(project.updatedAt).toLocaleString()}
                  </div>
                </div>
                <button
                  aria-label="删除项目"
                  className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-destructive group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(project.id);
                  }}
                  type="button"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="rounded-xl border bg-muted/30 p-3">
          <div className="mb-2 text-muted-foreground text-xs">新建项目</div>
          <div className="flex gap-2">
            <Input
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                onCreate(name);
                setName("");
                onOpenChange(false);
              }}
              placeholder="例如：Transformer 复现"
              value={name}
            />
            <Button
              onClick={() => {
                onCreate(name);
                setName("");
                onOpenChange(false);
              }}
              size="sm"
            >
              <Plus className="size-3.5" />
              新建
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
