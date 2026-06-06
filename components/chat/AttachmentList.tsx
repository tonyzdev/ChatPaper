"use client";

import { FileText, X } from "lucide-react";

export interface Attachment {
  file: File;
  url: string;
}

export function AttachmentList({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (index: number) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((a, i) => {
        const isImage = a.file.type.startsWith("image/");
        return (
          <div className="group relative" key={`${a.file.name}-${i}`}>
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={a.file.name}
                className="size-14 rounded-lg border object-cover"
                src={a.url}
              />
            ) : (
              <div className="flex size-14 flex-col items-center justify-center gap-1 rounded-lg border bg-muted px-1 text-center text-[10px] text-muted-foreground">
                <FileText className="size-4 shrink-0" />
                <span className="line-clamp-1 break-all">{a.file.name}</span>
              </div>
            )}
            <button
              aria-label="移除附件"
              className="-top-1.5 -right-1.5 absolute flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100"
              onClick={() => onRemove(i)}
              type="button"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
