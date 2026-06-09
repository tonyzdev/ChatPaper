import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSafeBaseURL, isServerKeyAllowed } from "@/lib/security";

describe("assertSafeBaseURL", () => {
  it("空值返回 undefined（走官方默认）", () => {
    expect(assertSafeBaseURL(undefined)).toBeUndefined();
    expect(assertSafeBaseURL(null)).toBeUndefined();
    expect(assertSafeBaseURL("   ")).toBeUndefined();
  });

  it("合法 https 域名放行并去掉尾部斜杠", () => {
    expect(assertSafeBaseURL("https://api.siliconflow.cn/v1/")).toBe(
      "https://api.siliconflow.cn/v1",
    );
    expect(
      assertSafeBaseURL("https://dashscope.aliyuncs.com/compatible-mode/v1"),
    ).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
  });

  it("拒绝 http", () => {
    expect(() => assertSafeBaseURL("http://api.example.com/v1")).toThrow(
      /https/,
    );
  });

  it("拒绝 IPv4 字面量（含云元数据端点）", () => {
    expect(() => assertSafeBaseURL("https://169.254.169.254/v1")).toThrow(
      /内网/,
    );
    expect(() => assertSafeBaseURL("https://10.0.0.1/api")).toThrow(/内网/);
  });

  it("拒绝 IPv6 字面量", () => {
    expect(() => assertSafeBaseURL("https://[::1]/v1")).toThrow(/内网/);
  });

  it("拒绝 localhost 与内网域名后缀", () => {
    expect(() => assertSafeBaseURL("https://localhost:3000/v1")).toThrow();
    expect(() => assertSafeBaseURL("https://foo.localhost/v1")).toThrow();
    expect(() => assertSafeBaseURL("https://db.local/v1")).toThrow();
    expect(() => assertSafeBaseURL("https://svc.internal/v1")).toThrow();
  });

  it("拒绝畸形 URL", () => {
    expect(() => assertSafeBaseURL("not-a-url")).toThrow(/不合法/);
  });
});

describe("isServerKeyAllowed", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("BYOK（自带 key）始终放行", () => {
    vi.stubEnv("ACCESS_CODE", "secret");
    expect(isServerKeyAllowed("sk-user-key", undefined)).toBe(true);
    expect(isServerKeyAllowed("sk-user-key", "wrong")).toBe(true);
  });

  it("未配置 ACCESS_CODE 时放行（向后兼容）", () => {
    vi.stubEnv("ACCESS_CODE", "");
    expect(isServerKeyAllowed(undefined, undefined)).toBe(true);
    expect(isServerKeyAllowed("", "")).toBe(true);
  });

  it("配置 ACCESS_CODE 后：口令正确放行、错误/缺失拒绝", () => {
    vi.stubEnv("ACCESS_CODE", "secret");
    expect(isServerKeyAllowed(undefined, "secret")).toBe(true);
    expect(isServerKeyAllowed("", " secret ")).toBe(true); // 容忍首尾空白
    expect(isServerKeyAllowed(undefined, "wrong")).toBe(false);
    expect(isServerKeyAllowed(undefined, undefined)).toBe(false);
    expect(isServerKeyAllowed("   ", "")).toBe(false);
  });
});
