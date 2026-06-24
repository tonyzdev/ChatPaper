import type { UIMessage } from "ai";
import type { Citation } from "@/lib/types";

export type ContextEngine = "builtin" | "open-notebook";
export type ContextScope = "current-pdf" | "project";

export interface OpenNotebookConnection {
  baseUrl: string;
  password?: string;
}

export interface OpenNotebookDocument {
  id: string;
  name: string;
  text: string;
}

export interface OpenNotebookConversation {
  id: string;
  title: string;
  messages: UIMessage[];
}

interface NotebookSummary {
  id: string;
  name: string;
  description?: string;
}

interface SourceSummary {
  id: string;
  title?: string;
}

interface NoteSummary {
  id: string;
  title?: string | null;
  content?: string | null;
}

interface OpenNotebookSourceContext {
  id?: string;
  title?: string;
  full_text?: string;
  insights?: { insight_type?: string; content?: string }[];
}

interface OpenNotebookNoteContext {
  id?: string;
  title?: string;
  content?: string;
}

interface OpenNotebookContextResponse {
  context: {
    sources: OpenNotebookSourceContext[];
    notes: OpenNotebookNoteContext[];
  };
  token_count: number;
  char_count: number;
}

const PROJECT_MARKER_PREFIX = "chatpaper-project:";
const PDF_TITLE_PREFIX = "[ChatPaper PDF:";
const CONVERSATION_TITLE_PREFIX = "ChatPaper 对话：";

function getMessageCitations(message: UIMessage): Citation[] | undefined {
  return (message.metadata as { citations?: Citation[] } | undefined)?.citations;
}

function normalizeBaseUrl(baseUrl: string): string {
  const input = baseUrl.trim();
  if (!input) throw new Error("请先填写 Open Notebook 地址");

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Open Notebook 地址不合法：${input.slice(0, 100)}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Open Notebook 地址必须以 http:// 或 https:// 开头");
  }

  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/api") ? path.slice(0, -4) || "/" : path || "/";
  return url.toString().replace(/\/+$/, "");
}

function authHeaders(password?: string, json = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  if (password?.trim()) headers.Authorization = `Bearer ${password.trim()}`;
  return headers;
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `Open Notebook 请求失败（${response.status} ${response.statusText}）`;
  try {
    const data = (await response.json()) as { detail?: string; error?: string; message?: string };
    return data.detail || data.error || data.message || fallback;
  } catch {
    return fallback;
  }
}

async function fetchJson<T>(
  connection: OpenNotebookConnection,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const baseUrl = normalizeBaseUrl(connection.baseUrl);
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) throw new Error(await readErrorMessage(response));
  return (await response.json()) as T;
}

function projectMarker(projectId: string): string {
  return `${PROJECT_MARKER_PREFIX}${projectId}`;
}

function buildNotebookDescription(projectId: string): string {
  return `Synced from ChatPaper\n${projectMarker(projectId)}`;
}

function extractProjectId(description?: string | null): string | null {
  const match = description?.match(/chatpaper-project:([^\s]+)/);
  return match?.[1] ?? null;
}

export async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function buildPdfSourceTitle(
  pdfId: string,
  name: string,
  contentHash: string,
): string {
  return `${PDF_TITLE_PREFIX}${pdfId}:${contentHash.slice(0, 12)}] ${name}`;
}

export function parsePdfSourceTitle(title?: string | null): {
  pdfId: string;
  hash: string;
  name: string;
} | null {
  if (!title?.startsWith(PDF_TITLE_PREFIX)) return null;
  const match = title.match(/^\[ChatPaper PDF:([^:]+):([^\]]+)\]\s*(.*)$/);
  if (!match) return null;
  return {
    pdfId: match[1],
    hash: match[2],
    name: match[3] || title,
  };
}

export function stripPdfSourceTitle(title?: string | null): string {
  return parsePdfSourceTitle(title)?.name || title || "未命名文档";
}

function conversationMarker(conversationId: string): string {
  return `<!-- chatpaper-conversation:${conversationId} -->`;
}

export function extractConversationId(content?: string | null): string | null {
  const match = content?.match(/^<!-- chatpaper-conversation:([^>]+) -->/m);
  return match?.[1] ?? null;
}

export function stripConversationMarker(content?: string | null): string {
  return (content || "")
    .replace(/^<!-- chatpaper-conversation:[^>]+ -->\s*/m, "")
    .trim();
}

function stripConversationTitle(title?: string | null): string {
  return (title || "未命名对话").replace(/^ChatPaper 对话：/, "");
}

function messageBody(message: UIMessage): string {
  return message.parts
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "file" && part.mediaType?.startsWith("image/")) {
        return `[图片：${part.filename ?? "附件图片"}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function buildConversationNoteContent(
  conversation: OpenNotebookConversation,
  documentNames: string[] = [],
): string {
  const lines: string[] = [
    conversationMarker(conversation.id),
    `# ${stripConversationTitle(conversation.title)}`,
    "",
  ];

  if (documentNames.length > 0) {
    lines.push(`> 项目文档：${summarizeNames(documentNames)}`, "");
  }

  for (const message of conversation.messages) {
    lines.push(message.role === "user" ? "## 用户" : "## 助手", "");
    const citations = getMessageCitations(message);
    if (citations?.length) {
      for (const citation of citations) {
        const label = citation.page != null ? `第 ${citation.page} 页` : citation.source;
        lines.push(`> 引用（${label}）：${citation.text}`);
      }
      lines.push("");
    }

    const body = messageBody(message);
    if (body) lines.push(body, "");
  }

  return `${lines.join("\n").trim()}\n`;
}

function summarizeNames(names: string[]): string {
  const trimmed = names.map((name) => name.trim()).filter(Boolean);
  if (trimmed.length <= 3) return trimmed.join("、");
  return `${trimmed.slice(0, 3).join("、")} 等 ${trimmed.length} 篇`;
}

function noteTitle(conversationTitle: string): string {
  const clean = stripConversationTitle(conversationTitle).trim() || "未命名对话";
  return `${CONVERSATION_TITLE_PREFIX}${clean}`;
}

async function ensureNotebook(
  connection: OpenNotebookConnection,
  project: { id: string; name: string },
): Promise<NotebookSummary> {
  const notebooks = await fetchJson<NotebookSummary[]>(
    connection,
    "/api/notebooks?order_by=updated%20desc",
    { headers: authHeaders(connection.password, false) },
  );

  const description = buildNotebookDescription(project.id);
  const existing = notebooks.find((item) => extractProjectId(item.description) === project.id);
  if (existing) {
    if (existing.name !== project.name || existing.description !== description) {
      return fetchJson<NotebookSummary>(
        connection,
        `/api/notebooks/${existing.id}`,
        {
          method: "PUT",
          headers: authHeaders(connection.password),
          body: JSON.stringify({ name: project.name, description }),
        },
      );
    }
    return existing;
  }

  return fetchJson<NotebookSummary>(connection, "/api/notebooks", {
    method: "POST",
    headers: authHeaders(connection.password),
    body: JSON.stringify({ name: project.name, description }),
  });
}

async function listSources(
  connection: OpenNotebookConnection,
  notebookId: string,
): Promise<SourceSummary[]> {
  const query = new URLSearchParams({
    notebook_id: notebookId,
    limit: "100",
    offset: "0",
    sort_by: "updated",
    sort_order: "desc",
  });
  return fetchJson<SourceSummary[]>(connection, `/api/sources?${query.toString()}`, {
    headers: authHeaders(connection.password, false),
  });
}

async function listNotes(
  connection: OpenNotebookConnection,
  notebookId: string,
): Promise<NoteSummary[]> {
  const query = new URLSearchParams({ notebook_id: notebookId });
  return fetchJson<NoteSummary[]>(connection, `/api/notes?${query.toString()}`, {
    headers: authHeaders(connection.password, false),
  });
}

async function deleteSource(connection: OpenNotebookConnection, sourceId: string) {
  const baseUrl = normalizeBaseUrl(connection.baseUrl);
  const response = await fetch(`${baseUrl}/api/sources/${sourceId}`, {
    method: "DELETE",
    headers: authHeaders(connection.password, false),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response));
}

async function deleteNote(connection: OpenNotebookConnection, noteId: string) {
  const baseUrl = normalizeBaseUrl(connection.baseUrl);
  const response = await fetch(`${baseUrl}/api/notes/${noteId}`, {
    method: "DELETE",
    headers: authHeaders(connection.password, false),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response));
}

async function createTextSource(
  connection: OpenNotebookConnection,
  notebookId: string,
  title: string,
  content: string,
) {
  return fetchJson(connection, "/api/sources/json", {
    method: "POST",
    headers: authHeaders(connection.password),
    body: JSON.stringify({
      type: "text",
      title,
      content,
      notebooks: [notebookId],
      embed: true,
      async_processing: false,
    }),
  });
}

async function createNote(
  connection: OpenNotebookConnection,
  notebookId: string,
  title: string,
  content: string,
) {
  return fetchJson(connection, "/api/notes", {
    method: "POST",
    headers: authHeaders(connection.password),
    body: JSON.stringify({
      notebook_id: notebookId,
      title,
      content,
      note_type: "human",
    }),
  });
}

async function updateNote(
  connection: OpenNotebookConnection,
  noteId: string,
  title: string,
  content: string,
) {
  return fetchJson(connection, `/api/notes/${noteId}`, {
    method: "PUT",
    headers: authHeaders(connection.password),
    body: JSON.stringify({ title, content, note_type: "human" }),
  });
}

async function syncPdfSources(
  connection: OpenNotebookConnection,
  notebookId: string,
  documents: OpenNotebookDocument[],
  sources: SourceSummary[],
) {
  const prepared = await Promise.all(
    documents
      .filter((document) => document.text.trim())
      .map(async (document) => ({
        document,
        hash: (await hashText(document.text)).slice(0, 12),
      })),
  );

  const desiredById = new Map(prepared.map((item) => [item.document.id, item]));
  const existingById = new Map<string, SourceSummary[]>();

  for (const source of sources) {
    const meta = parsePdfSourceTitle(source.title);
    if (!meta) continue;
    const items = existingById.get(meta.pdfId) ?? [];
    items.push(source);
    existingById.set(meta.pdfId, items);
  }

  for (const [pdfId, existing] of existingById) {
    const desired = desiredById.get(pdfId);
    const matching = existing.filter(
      (item) => parsePdfSourceTitle(item.title)?.hash === desired?.hash,
    );
    const stale = desired ? existing.filter((item) => !matching.includes(item)) : existing;
    for (const item of stale) await deleteSource(connection, item.id);
  }

  for (const item of prepared) {
    const existing = existingById
      .get(item.document.id)
      ?.find((source) => parsePdfSourceTitle(source.title)?.hash === item.hash);
    if (existing) continue;
    await createTextSource(
      connection,
      notebookId,
      buildPdfSourceTitle(item.document.id, item.document.name, item.hash),
      item.document.text,
    );
  }
}

async function syncConversationNotes(
  connection: OpenNotebookConnection,
  notebookId: string,
  conversations: OpenNotebookConversation[],
  notes: NoteSummary[],
  documentNames: string[],
  pruneMissing: boolean,
) {
  const desired = conversations
    .filter((conversation) => conversation.messages.length > 0)
    .map((conversation) => ({
      conversation,
      title: noteTitle(conversation.title),
      content: buildConversationNoteContent(conversation, documentNames),
    }));

  const desiredIds = new Set(desired.map((item) => item.conversation.id));
  const existingById = new Map<string, NoteSummary[]>();
  for (const note of notes) {
    const conversationId = extractConversationId(note.content);
    if (!conversationId) continue;
    const items = existingById.get(conversationId) ?? [];
    items.push(note);
    existingById.set(conversationId, items);
  }

  if (pruneMissing) {
    for (const [conversationId, items] of existingById) {
      if (desiredIds.has(conversationId)) continue;
      for (const note of items) await deleteNote(connection, note.id);
    }
  }

  for (const item of desired) {
    const existing = existingById.get(item.conversation.id) ?? [];
    const [primary, ...duplicates] = existing;
    for (const duplicate of duplicates) await deleteNote(connection, duplicate.id);

    if (!primary) {
      await createNote(connection, notebookId, item.title, item.content);
      continue;
    }

    const currentContent = (primary.content ?? "").trim();
    const desiredContent = item.content.trim();
    if ((primary.title ?? "") === item.title && currentContent === desiredContent) {
      continue;
    }

    await updateNote(connection, primary.id, item.title, item.content);
  }
}

export async function syncProjectToOpenNotebook({
  connection,
  project,
  documents,
  conversations,
}: {
  connection: OpenNotebookConnection;
  project: { id: string; name: string };
  documents: OpenNotebookDocument[];
  conversations: OpenNotebookConversation[];
}): Promise<{ notebookId: string }> {
  const notebook = await ensureNotebook(connection, project);
  const [sources, notes] = await Promise.all([
    listSources(connection, notebook.id),
    listNotes(connection, notebook.id),
  ]);
  const documentNames = documents.map((document) => document.name);

  await syncPdfSources(connection, notebook.id, documents, sources);
  await syncConversationNotes(
    connection,
    notebook.id,
    conversations,
    notes,
    documentNames,
    true,
  );

  return { notebookId: notebook.id };
}

export async function syncConversationNoteToOpenNotebook({
  connection,
  project,
  documentNames,
  conversation,
}: {
  connection: OpenNotebookConnection;
  project: { id: string; name: string };
  documentNames: string[];
  conversation: OpenNotebookConversation;
}): Promise<{ notebookId: string }> {
  const notebook = await ensureNotebook(connection, project);
  const notes = await listNotes(connection, notebook.id);
  await syncConversationNotes(
    connection,
    notebook.id,
    [conversation],
    notes,
    documentNames,
    false,
  );
  return { notebookId: notebook.id };
}

function truncateJoinedSections(sections: string[], charBudget: number): string {
  if (sections.length === 0) return "";
  const blocks: string[] = [];
  let used = 0;

  for (let index = 0; index < sections.length; index += 1) {
    const separator = blocks.length > 0 ? "\n\n---\n\n" : "";
    const next = `${separator}${sections[index]}`;
    if (used + next.length <= charBudget) {
      blocks.push(next);
      used += next.length;
      continue;
    }

    const remaining = charBudget - used - separator.length;
    if (remaining > 80) {
      blocks.push(
        `${separator}${sections[index].slice(0, remaining)}\n\n…（后续上下文因长度限制已截断）`,
      );
    } else if (blocks.length > 0) {
      blocks.push(`${separator}…（其余上下文因长度限制已省略）`);
    }
    break;
  }

  return blocks.join("");
}

export function formatOpenNotebookContext(
  projectName: string,
  context: OpenNotebookContextResponse["context"],
  charBudget = 70_000,
  scope: ContextScope = "project",
): string | null {
  const sections: string[] = [];

  for (const source of context.sources ?? []) {
    const title = stripPdfSourceTitle(source.title);
    const bodyParts: string[] = [];
    const fullText = source.full_text?.trim();
    if (fullText) bodyParts.push(fullText);

    const insights = source.insights
      ?.map((item) => {
        const content = item.content?.trim();
        if (!content) return null;
        return `- ${item.insight_type || "Insight"}：${content}`;
      })
      .filter((item): item is string => Boolean(item));

    if (insights?.length) bodyParts.push(`Insights:\n${insights.join("\n")}`);
    if (bodyParts.length === 0) continue;
    sections.push(`## 文档：${title}\n\n${bodyParts.join("\n\n")}`);
  }

  for (const note of context.notes ?? []) {
    const body = stripConversationMarker(note.content).trim();
    if (!body) continue;
    sections.push(`## 历史对话：${stripConversationTitle(note.title)}\n\n${body}`);
  }

  if (sections.length === 0) return null;
  const body = truncateJoinedSections(sections, charBudget);
  const intro =
    scope === "current-pdf"
      ? `以下是来自 Open Notebook 的当前 PDF 上下文，所属项目为《${projectName || "当前项目"}》。`
      : `以下是来自 Open Notebook 项目《${projectName || "当前项目"}》的项目级上下文。`;
  const instruction =
    scope === "current-pdf"
      ? "请只把它当作当前左侧 PDF 的背景材料；若与当前用户消息或用户显式引用冲突，以当前消息和显式引用为准。"
      : "它可能包含多篇 PDF 与历史对话；把它当作背景材料。若与当前用户消息或用户显式引用冲突，以当前消息和显式引用为准。";

  return [intro, instruction, "", body].join("\n");
}

export async function buildOpenNotebookContext({
  connection,
  notebookId,
  projectName,
  currentConversationId,
  currentPdfId,
  scope = "project",
}: {
  connection: OpenNotebookConnection;
  notebookId: string;
  projectName: string;
  currentConversationId?: string | null;
  currentPdfId?: string | null;
  scope?: ContextScope;
}): Promise<string | null> {
  const [sources, notes] = await Promise.all([
    listSources(connection, notebookId),
    listNotes(connection, notebookId),
  ]);

  const scopedSources =
    scope === "current-pdf"
      ? sources.filter((source) => parsePdfSourceTitle(source.title)?.pdfId === currentPdfId)
      : sources;
  const sourceIds = scopedSources.map((source) => source.id);
  const noteIds =
    scope === "project"
      ? notes
          .filter((note) => extractConversationId(note.content) !== currentConversationId)
          .map((note) => note.id)
      : [];

  if (sourceIds.length === 0 && noteIds.length === 0) return null;

  const response = await fetchJson<OpenNotebookContextResponse>(
    connection,
    "/api/chat/context",
    {
      method: "POST",
      headers: authHeaders(connection.password),
      body: JSON.stringify({
        notebook_id: notebookId,
        context_config: {
          sources: Object.fromEntries(sourceIds.map((id) => [id, "full content"])),
          notes: Object.fromEntries(noteIds.map((id) => [id, "full content"])),
        },
      }),
    },
  );

  return formatOpenNotebookContext(projectName, response.context, 70_000, scope);
}
