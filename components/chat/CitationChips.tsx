"use client";

import { X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

export function CitationChips() {
  const citations = useAppStore((s) => s.citations);
  const removeCitation = useAppStore((s) => s.removeCitation);

  if (citations.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-1">
      {citations.map((c) => (
        <div
          className="group flex items-center gap-2 rounded-r border-l-2 border-primary/40 bg-muted/50 py-1 pr-1 pl-2 text-xs"
          key={c.id}
        >
          <span className="line-clamp-1 flex-1 text-muted-foreground">
            {c.text}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground/60">
            第 {c.page} 页
          </span>
          <button
            aria-label="移除引用"
            className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-background hover:text-foreground"
            onClick={() => removeCitation(c.id)}
            type="button"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
