/**
 * 校验客户端传来的 Base URL，防 SSRF：公网部署时，恶意请求可借服务端
 * 向内网/云元数据端点（如 169.254.169.254）发请求。规则：
 * - 必须是 https
 * - 主机不能是 IP 字面量（IPv4/IPv6）或 localhost / *.local / *.internal
 * 空值返回 undefined（走各 provider 官方默认）；通过校验则去掉尾部斜杠。
 */
export function assertSafeBaseURL(
  baseURL: string | undefined | null,
): string | undefined {
  const url = baseURL?.trim();
  if (!url) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Base URL 格式不合法：${url.slice(0, 100)}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Base URL 必须是 https:// 开头");
  }
  const host = parsed.hostname.toLowerCase();
  const isIpLiteral =
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("["); // IPv6 hostname 带方括号
  if (
    isIpLiteral ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("Base URL 不允许指向 IP / 内网 / 本机地址");
  }
  return url.replace(/\/+$/, "");
}

/**
 * 站点访问口令：服务端设置 ACCESS_CODE 后，「不带自有 API Key、
 * 走服务端内置 Key（环境变量 / AI Gateway）」的请求必须携带正确口令，
 * 防止公网部署后被任意访客白嫖内置额度。BYOK（自带 Key）请求不受限。
 */
export function isServerKeyAllowed(
  clientApiKey: string | undefined,
  clientAccessCode: string | undefined,
): boolean {
  if (clientApiKey?.trim()) return true; // BYOK，不消耗服务端额度
  const required = process.env.ACCESS_CODE?.trim();
  if (!required) return true; // 站点未启用口令
  return clientAccessCode?.trim() === required;
}
