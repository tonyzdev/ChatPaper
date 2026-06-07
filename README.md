# ChatPaper

> 边读 PDF 边和 AI 对话 —— 左侧是 PDF 阅读器，右侧是流式 chatbot。在 PDF 上划选文本即可作为「引用」向 AI 提问，或一键翻译。

**在线体验**：https://chatpaper-seven.vercel.app

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![React](https://img.shields.io/badge/React-19-149eca) ![AI SDK](https://img.shields.io/badge/Vercel_AI_SDK-6-black) ![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ 功能

- 📄 **双栏布局**：左侧 PDF 阅读器 + 右侧 AI 对话，可拖拽调整宽度，整页固定不滚动，仅内部面板滚动。
- ✂️ **划选即引用**：在 PDF 上选中文本，加入对话作为引用（带页码来源），再补充指令向 AI 提问。
- 💬 **流式回答**：Markdown 排版、KaTeX 数学公式、代码高亮（基于 Vercel Streamdown）。
- 🌐 **翻译模式**：右上角切换到翻译模式后，左侧划选文本即自动翻译（中英互译），可单独指定轻量模型。
- 🔑 **BYOK（自带 Key）**：支持 **Anthropic（Claude）/ OpenAI（GPT）/ DeepSeek**，API Key 仅存浏览器本地，随请求直发模型，不经第三方存储。
- 🖼️ **图片输入**：上传或 `Ctrl+V` 粘贴图片；对不支持图像的模型（如 DeepSeek），可配置 **Qwen-VL** 视觉模型在上传时先把图转写为 Markdown 文本再喂给主模型。
- 🧠 **DeepSeek 推理模式**：可在设置中开启 thinking，展示可折叠的「思考过程」（默认关）。
- 🌗 **三种颜色主题**：日间 / 护眼绿 / 夜间，全局生效（含 PDF 纸张本身的反色 / 染色），并持久化。
- 🕘 **历史会话**：会话与当时打开的 PDF 关联（PDF 存 IndexedDB），切换历史对话或刷新页面都会自动恢复当时的 PDF 与消息。
- 💾 **本地持久化**：设置、会话、主题等偏好都保存在浏览器。

## 🧱 技术栈

| 领域 | 选型 |
| --- | --- |
| 框架 | Next.js 16（App Router, Turbopack）+ React 19 + TypeScript |
| 样式 | Tailwind CSS v4 + shadcn/ui（base-ui） |
| AI | [Vercel AI SDK 6](https://ai-sdk.dev)：`ai` / `@ai-sdk/react` / `@ai-sdk/anthropic` / `@ai-sdk/openai` / `@ai-sdk/deepseek` / `@ai-sdk/openai-compatible` |
| 聊天 UI | Vercel AI Elements + [Streamdown](https://streamdown.ai)（流式 Markdown / KaTeX / Shiki） |
| PDF | [react-pdf](https://github.com/wojtekmaj/react-pdf)（pdf.js） |
| 布局 | react-resizable-panels |
| 状态 | zustand（persist）+ IndexedDB（PDF 持久化） |
| 部署 | Vercel |

## 🚀 本地开发

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。无需任何服务端环境变量 —— 直接在应用内「设置」填入你自己的 API Key 即可。

## 🔑 配置 API Key（BYOK）

点击右上角 ⚙️ **设置**：

1. 选择模型提供商（Anthropic / DeepSeek / OpenAI），填入对应 API Key 与模型名。OpenAI / Anthropic 可选填 Base URL 以使用兼容接口。
2. （可选）**独立翻译模型**：默认翻译跟随对话模型；开启后可单独配置轻量模型，例如对话用 Pro、翻译用 Flash。同 provider 可留空翻译 Key/Base URL 复用主配置。
3. （可选）**图像转写**：DeepSeek 等不支持图像的模型，可开启并填入 Qwen（阿里云百炼 DashScope）的 Key，默认模型 `qwen3-vl-flash`，可点「测试连接」验证。
4. （DeepSeek）可开启**推理模式**展示思考过程。

> Key 仅保存在浏览器 `localStorage`，通过 HTTPS 随请求发送到对应模型服务，本项目服务端不存储任何 Key。

## ☁️ 部署

项目为标准 Next.js 应用，推荐部署到 **Vercel**：连接 GitHub 仓库后自动构建部署。由于采用 BYOK，**无需配置任何服务端环境变量**即可运行。

也可选配服务端环境变量作为默认 Key：`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY`。

## 🏗️ 架构要点

- **PDF 不上传服务器**：在浏览器用 blob URL 渲染，划选的文本随消息一起发给后端，无需向量库 / RAG。
- **薄后端**：仅一个 `app/api/chat/route.ts`，用 `streamText` 流式返回；引用内容注入到最后一条用户消息以确保模型读到。
- **图像转写**：`app/api/transcribe`，用 OpenAI 兼容接口调用 Qwen-VL 把图片转 Markdown（DeepSeek 标准 API 不支持图像输入）。

## 📄 License

MIT
