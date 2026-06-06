import { create } from "zustand";
import type { Citation } from "@/lib/types";

interface AppState {
  /** 当前 PDF 的 blob URL（仅存在于浏览器，不上传服务器） */
  fileUrl: string | null;
  fileName: string | null;
  numPages: number;
  /** 已加入对话的引用 */
  citations: Citation[];

  openPdf: (file: File) => void;
  closePdf: () => void;
  setNumPages: (n: number) => void;
  addCitation: (c: Omit<Citation, "id">) => void;
  removeCitation: (id: string) => void;
  clearCitations: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  fileUrl: null,
  fileName: null,
  numPages: 0,
  citations: [],

  openPdf: (file) => {
    const prev = get().fileUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      fileUrl: URL.createObjectURL(file),
      fileName: file.name,
      numPages: 0,
      citations: [],
    });
  },

  closePdf: () => {
    const prev = get().fileUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({ fileUrl: null, fileName: null, numPages: 0, citations: [] });
  },

  setNumPages: (n) => set({ numPages: n }),

  addCitation: (c) =>
    set((s) => ({
      citations: [...s.citations, { ...c, id: crypto.randomUUID() }],
    })),

  removeCitation: (id) =>
    set((s) => ({ citations: s.citations.filter((x) => x.id !== id) })),

  clearCitations: () => set({ citations: [] }),
}));
