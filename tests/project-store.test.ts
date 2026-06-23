import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  currentConversation,
  currentProject,
  currentProjectConversations,
  currentProjectPdfs,
  migrateLegacyProjects,
  pdfSummary,
  type Project,
  useAppStore,
} from "@/store/useAppStore";

const message = (text: string): UIMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
});

describe("migrateLegacyProjects", () => {
  it("把旧会话逐条迁移成独立项目，并保留当前会话定位", () => {
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const out = migrateLegacyProjects(
      [
        {
          id: firstId,
          title: "第一段对话",
          messages: [message("hello")],
          updatedAt: 100,
          pdfs: [{ id: "pdf-1", name: "paper-a.pdf" }],
        },
        {
          id: secondId,
          title: "第二段对话",
          messages: [message("world")],
          updatedAt: 200,
          pdfId: "pdf-2",
          pdfName: "paper-b.pdf",
        },
      ],
      secondId,
    );

    expect(out.projects).toHaveLength(2);
    expect(out.projects[0].conversations).toHaveLength(1);
    expect(out.projects[0].currentConversationId).toBe(firstId);
    expect(out.projects[0].pdfs).toEqual([{ id: "pdf-1", name: "paper-a.pdf" }]);
    expect(out.projects[1].pdfs).toEqual([{ id: "pdf-2", name: "paper-b.pdf" }]);
    expect(out.currentProjectId).toBe(out.projects[1].id);
  });

  it("无旧数据时返回空项目集", () => {
    expect(migrateLegacyProjects(undefined, null)).toEqual({
      projects: [],
      currentProjectId: null,
    });
  });
});

describe("project selectors", () => {
  const projects: Project[] = [
    {
      id: "project-1",
      name: "Project One",
      updatedAt: 10,
      pdfs: [{ id: "pdf-1", name: "paper-a.pdf" }],
      currentPdfId: "pdf-1",
      currentConversationId: "conv-1",
      conversations: [
        {
          id: "conv-1",
          title: "问摘要",
          messages: [message("summary")],
          updatedAt: 10,
        },
      ],
    },
  ];

  it("返回当前项目、对话和 PDF 列表", () => {
    const state = { projects, currentProjectId: "project-1" };
    expect(currentProject(state)?.name).toBe("Project One");
    expect(currentConversation(state)?.id).toBe("conv-1");
    expect(currentProjectConversations(state)).toHaveLength(1);
    expect(currentProjectPdfs(state)).toEqual([{ id: "pdf-1", name: "paper-a.pdf" }]);
  });

  it("无当前项目时返回稳定的空数组引用", () => {
    const state = { projects: [], currentProjectId: null };
    expect(currentProjectConversations(state)).toBe(currentProjectConversations(state));
    expect(currentProjectPdfs(state)).toBe(currentProjectPdfs(state));
  });
});

describe("project actions", () => {
  it("支持创建、切换、删除项目并保留各自对话", () => {
    useAppStore.setState({
      fileUrl: null,
      fileName: null,
      pdfId: null,
      pdfFullTexts: {},
      numPages: 0,
      citations: [],
      annotations: [],
      pdfFullText: null,
      pdfTextStatus: "idle",
      pdfTextProgress: 0,
      projects: [],
      currentProjectId: null,
      pendingTranslate: null,
      pendingPdf: null,
      pdfJump: null,
    });

    const alphaId = useAppStore.getState().createProject("Alpha");
    useAppStore.getState().ensureConversation();
    useAppStore.getState().upsertCurrent([message("alpha chat")]);
    const alphaConversation = currentConversation(useAppStore.getState());

    const betaId = useAppStore.getState().createProject("Beta");
    expect(currentProject(useAppStore.getState())?.name).toBe("Beta");
    expect(currentConversation(useAppStore.getState())).toBeUndefined();

    useAppStore.getState().switchProject(alphaId);
    expect(currentProject(useAppStore.getState())?.name).toBe("Alpha");
    expect(currentConversation(useAppStore.getState())?.id).toBe(
      alphaConversation?.id,
    );

    const nextId = useAppStore.getState().deleteProject(alphaId);
    expect(nextId).toBe(betaId);
    expect(currentProject(useAppStore.getState())?.name).toBe("Beta");
  });
});

describe("pdfSummary", () => {
  it("按数量格式化项目 PDF 摘要", () => {
    expect(pdfSummary([])).toBe("未关联 PDF");
    expect(pdfSummary([{ id: "1", name: "one.pdf" }])).toBe("one.pdf");
    expect(
      pdfSummary([
        { id: "1", name: "one.pdf" },
        { id: "2", name: "two.pdf" },
      ]),
    ).toBe("one.pdf 等 2 篇");
  });
});
