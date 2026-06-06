"use client";

import { FileText, Loader2, X } from "lucide-react";

export interface Attachment {
  file: File;
  url: string;
  /** ready：无需/已完成处理；transcribing：正在转写；error：转写失败 */
  status: "ready" | "transcribing" | "error";
  /** 视觉转写结果（给不支持图像的模型用） */
  transcription?: string;
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

            {/* 转写中：loading 遮罩 */}
            {a.status === "transcribing" ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : null}

            {/* 转写失败 */}
            {a.status === "error" ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-destructive/15 px-1 text-center text-[9px] text-destructive">
                解析失败
              </div>
            ) : null}

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
