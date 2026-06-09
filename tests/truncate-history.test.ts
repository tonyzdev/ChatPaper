import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { truncateHistory } from "@/app/api/chat/route";

let nextId = 0;
const msg = (role: "user" | "assistant", chars: number): UIMessage => ({
  id: `m${nextId++}`,
  role,
  parts: [{ type: "text", text: "x".repeat(chars) }],
});

describe("truncateHistory", () => {
  it("预算内原样返回（同一数组引用，不复制）", () => {
    const messages = [msg("user", 100), msg("assistant", 100)];
    expect(truncateHistory(messages, 1000)).toBe(messages);
  });

  it("超预算时丢弃最早的消息，保留最近的", () => {
    const messages = [
      msg("user", 500),
      msg("assistant", 500),
      msg("user", 500),
      msg("assistant", 500),
    ];
    const out = truncateHistory(messages, 1100);
    expect(out.length).toBeLessThan(messages.length);
    expect(out.at(-1)).toBe(messages.at(-1)); // 最新的一定保留
  });

  it("截断起点对齐到 user 消息，不以 assistant 开头", () => {
    const messages = [
      msg("user", 800),
      msg("assistant", 800),
      msg("user", 200),
      msg("assistant", 200),
      msg("user", 200),
    ];
    const out = truncateHistory(messages, 700);
    expect(out[0].role).toBe("user");
  });

  it("单条超大消息也至少保留最后一条", () => {
    const messages = [msg("user", 50), msg("user", 999_999)];
    const out = truncateHistory(messages, 1000);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(messages[1]);
  });

  it("非文本 part（图片）按固定开销估算", () => {
    const img: UIMessage = {
      id: "img",
      role: "user",
      parts: [{ type: "file", mediaType: "image/png", url: "data:..." }],
    };
    // 2 条图片消息 ≈ 4000 估算字符，预算 3000 只留得下最近一条
    const out = truncateHistory([img, { ...img, id: "img2" }], 3000);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("img2");
  });

  it("空历史原样返回", () => {
    expect(truncateHistory([], 1000)).toEqual([]);
  });
});
