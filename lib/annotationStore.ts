// 用 IndexedDB 持久化每个 PDF 的高亮批注（按 pdfId 存整个数组；
// 单篇高亮量不大，整存整取最简单）。沿用 pdfStore / kvStore 的模式。
import type { Annotation } from "./types";

const DB_NAME = "chatpaper-annotations";
const STORE = "byPdf";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadAnnotations(pdfId: string): Promise<Annotation[]> {
  const db = await openDb();
  try {
    return await new Promise<Annotation[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(pdfId);
      req.onsuccess = () =>
        resolve(Array.isArray(req.result) ? (req.result as Annotation[]) : []);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveAnnotations(
  pdfId: string,
  items: Annotation[],
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(items, pdfId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteAnnotations(pdfId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(pdfId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 忽略删除失败
  }
}
