"use client";

import { X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

export function CitationChips() {
  const citations = useAppStore((s) => s.citations);
  const removeCitation = useAppStore((s) => s.removeCitation);

  if (citations.length === 0) return null;

  return (
    <div className="flex w-full flex-wrap gap-1.5">
      {citations.map((c) => (
        <span
          className="group inline-flex max-w-[16rem] items-center gap-1 rounded-md border bg-muted/60 py-1 pr-1 pl-1.5 text-xs"
          key={c.id}
        >
          <span className="shrink-0 rounded bg-primary/10 px-1 font-medium text-primary">
            p.{c.page}
          </span>
          <span className="truncate text-muted-foreground" title={c.text}>
            {c.text}
          </span>
          <button
            aria-label="移除引用"
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            onClick={() => removeCitation(c.id)}
            type="button"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
