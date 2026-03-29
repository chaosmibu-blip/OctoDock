/**
 * Custom Adapter Engine
 * 根據 JSON spec 動態執行 API 呼叫，不需要寫 TypeScript adapter
 * 安全限制：只允許 HTTPS、禁止 localhost/內網/cloud metadata IP、DNS rebinding 防護、限制 response 大小
 *
 * Rate limiting: handled at the API route level (see src/app/api/ route handlers)
 */
import { resolve4, resolve6 } from "node:dns/promises";
import type { AppAdapter, ToolDefinition, ToolResult, ApiKeyConfig } from "@/adapters/types";

// ── Spec 型別定義 ──

interface ActionSpec {
  name: string;
  action: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  endpoint: string;
  params?: Record<string, { type: string; required?: boolean; description?: string }>;
  responseFormat?: string;
}

interface AuthSpec {
  type: "oauth2" | "api_key";
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  instructions?: string;
}

interface ErrorHint {
  match: string;
  hint: string;
}

export interface CustomAdapterSpec {
  appName: string;
  displayName: string;
  baseUrl: string;
  auth?: AuthSpec;
  actionMap: Record<string, string>;
  actions: ActionSpec[];
  skillOverview?: string;
  errorHints?: ErrorHint[];
}

// ── 安全限制 ──

const MAX_RESPONSE_SIZE = 100_000; // 100KB
const REQUEST_TIMEOUT_MS = 15_000; // 15 秒

/** 判定單一 IP 是否為內網 / cloud metadata / link-local */
function isInternalIp(ip: string): boolean {
  // IPv4
  if (ip === "127.0.0.1" || ip === "0.0.0.0") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // Cloud metadata (AWS / Azure / GCP link-local)
  if (ip.startsWith("169.254.")) return true;
  // IPv6 loopback, link-local, ULA
  if (ip === "::1" || ip === "::") return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith("fe80:")) return true;   // link-local
  if (lower.startsWith("fd00:") || lower.startsWith("fc00:")) return true; // ULA
  return false;
}

/** 禁止的 URL pattern（防止 SSRF） */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
    if (host === "localhost") return false;
    if (isInternalIp(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * DNS resolution check — resolve hostname and verify all resolved IPs are safe.
 * Prevents DNS rebinding attacks where a public hostname resolves to an internal IP.
 */
async function assertResolvedIpSafe(url: string): Promise<void> {
  const { hostname } = new URL(url);
  // Skip check for raw IPs (already validated by isSafeUrl)
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) return;

  const ips: string[] = [];
  try {
    const v4 = await resolve4(hostname).catch(() => [] as string[]);
    const v6 = await resolve6(hostname).catch(() => [] as string[]);
    ips.push(...v4, ...v6);
  } catch {
    throw new Error(`DNS resolution failed for ${hostname}`);
  }

  if (ips.length === 0) {
    throw new Error(`DNS resolution returned no addresses for ${hostname}`);
  }

  for (const ip of ips) {
    if (isInternalIp(ip)) {
      throw new Error(`Blocked: ${hostname} resolves to internal IP`);
    }
  }
}

// ── 從 spec 建立 AppAdapter ──

export function buildCustomAdapter(spec: CustomAdapterSpec): AppAdapter {
  const actionMap = spec.actionMap;
  const actionsIndex = new Map<string, ActionSpec>();
  for (const a of spec.actions) {
    actionsIndex.set(a.name, a);
  }

  const tools: ToolDefinition[] = spec.actions.map((a) => ({
    name: a.name,
    description: a.description,
    inputSchema: {},
  }));

  const authConfig: ApiKeyConfig = {
    type: "api_key",
    instructions: {
      zh: spec.auth?.instructions ?? "請在 Dashboard 設定此 App 的 API Key",
      en: spec.auth?.instructions ?? "Please configure the API Key in Dashboard",
    },
    validateEndpoint: spec.baseUrl,
  };

  const adapter: AppAdapter = {
    name: spec.appName,
    displayName: { zh: spec.displayName, en: spec.displayName },
    icon: "custom",
    authType: spec.auth?.type === "oauth2" ? "oauth2" : "api_key",
    authConfig,
    tools,
    actionMap,

    getSkill(action?: string): string | null {
      if (!action) {
        return `# ${spec.displayName} (custom adapter)\n${spec.skillOverview ?? Object.keys(actionMap).join(", ")}`;
      }
      const toolName = actionMap[action];
      const actionSpec = toolName ? actionsIndex.get(toolName) : null;
      if (!actionSpec) return null;

      let text = `## ${spec.appName}.${action}\n${actionSpec.description}\n### Parameters\n`;
      if (actionSpec.params) {
        for (const [k, v] of Object.entries(actionSpec.params)) {
          text += `  ${k}${v.required ? " (required)" : " (optional)"}: ${v.description ?? v.type}\n`;
        }
      }
      text += `### Example\noctodock_do(app:"${spec.appName}", action:"${action}", params:{...}, intent:"...")`;
      return text;
    },

    formatResponse(action: string, rawData: unknown): string {
      const toolName = actionMap[action];
      const actionSpec = toolName ? actionsIndex.get(toolName) : null;
      if (actionSpec?.responseFormat) {
        // responseFormat 是給人讀的描述，作為 fallback hint
        // 實際還是回傳結構化資料
      }
      if (typeof rawData === "string") return rawData;
      return JSON.stringify(rawData, null, 2);
    },

    formatError(_action: string, errorMsg: string): string | null {
      if (!spec.errorHints) return null;
      for (const hint of spec.errorHints) {
        try {
          if (new RegExp(hint.match, "i").test(errorMsg)) {
            return hint.hint;
          }
        } catch {
          // 無效 regex，跳過
        }
      }
      return null;
    },

    async execute(
      toolName: string,
      params: Record<string, unknown>,
      token: string,
    ): Promise<ToolResult> {
      const actionSpec = actionsIndex.get(toolName);
      if (!actionSpec) {
        return {
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
      }

      // 構建 URL：替換 path params（:param 或 {param}）
      let endpoint = actionSpec.endpoint;
      const bodyParams: Record<string, unknown> = {};
      const queryParams: URLSearchParams = new URLSearchParams();

      for (const [key, value] of Object.entries(params)) {
        if (key.startsWith("_")) continue; // 跳過內部參數
        const pathPlaceholder1 = `:${key}`;
        const pathPlaceholder2 = `{${key}}`;
        if (endpoint.includes(pathPlaceholder1)) {
          endpoint = endpoint.replace(pathPlaceholder1, encodeURIComponent(String(value)));
        } else if (endpoint.includes(pathPlaceholder2)) {
          endpoint = endpoint.replace(pathPlaceholder2, encodeURIComponent(String(value)));
        } else if (actionSpec.method === "GET" || actionSpec.method === "DELETE") {
          queryParams.set(key, String(value));
        } else {
          bodyParams[key] = value;
        }
      }

      const qs = queryParams.toString();
      const fullUrl = `${spec.baseUrl}${endpoint}${qs ? `?${qs}` : ""}`;

      // 安全檢查
      if (!isSafeUrl(fullUrl)) {
        return {
          content: [{ type: "text", text: "Blocked: URL must be HTTPS and not target internal networks" }],
          isError: true,
        };
      }

      // DNS rebinding 防護：確認解析後的 IP 也不是內網
      try {
        await assertResolvedIpSafe(fullUrl);
      } catch (dnsErr) {
        return {
          content: [{ type: "text", text: dnsErr instanceof Error ? dnsErr.message : "DNS check failed" }],
          isError: true,
        };
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const hasBody = ["POST", "PUT", "PATCH"].includes(actionSpec.method);
        const res = await fetch(fullUrl, {
          method: actionSpec.method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: hasBody ? JSON.stringify(bodyParams) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          console.error(`[custom:${spec.appName}] ${res.status} ${endpoint} | ${errText}`);
          throw new Error(`${spec.displayName} API error: ${res.status} ${errText}`);
        }

        const text = await res.text();
        if (text.length > MAX_RESPONSE_SIZE) {
          return {
            content: [{ type: "text", text: text.substring(0, MAX_RESPONSE_SIZE) + "\n...(truncated)" }],
          };
        }

        // 嘗試 parse 為 JSON
        try {
          const json = JSON.parse(text);
          return {
            content: [{ type: "text", text: JSON.stringify(json) }],
          };
        } catch {
          return {
            content: [{ type: "text", text }],
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: msg }],
          isError: true,
        };
      }
    },
  };

  return adapter;
}

// ── Test Adapter ──

interface TestAdapterResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  error?: string;
  preview?: string;
}

/** Mask API key for safe inclusion in error messages — show only first 4 chars */
function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return key.slice(0, 4) + "****";
}

/**
 * Test a custom adapter spec with a single API request.
 * Picks the safest GET action (no required params), or falls back to the first GET action.
 * Returns a concise result without leaking the full API key.
 */
export async function testAdapter(
  spec: CustomAdapterSpec,
  apiKey: string,
): Promise<TestAdapterResult> {
  // Pick test action: prefer GET with no required params
  const getActions = spec.actions.filter((a) => a.method === "GET");
  if (getActions.length === 0) {
    return { ok: false, status: 0, latencyMs: 0, error: "No GET action available to test" };
  }
  const safeAction =
    getActions.find((a) => {
      if (!a.params) return true;
      const hasRequiredParams = Object.values(a.params).some((p) => p.required);
      const hasPathParams = a.endpoint.includes(":") || a.endpoint.includes("{");
      return !hasRequiredParams && !hasPathParams;
    }) ?? getActions.find((a) => {
      // Fallback: GET with no path params
      return !a.endpoint.includes(":") && !a.endpoint.includes("{");
    }) ?? getActions[0];

  // Strip path params from endpoint for test (best-effort)
  let testEndpoint = safeAction.endpoint;
  if (testEndpoint.includes(":") || testEndpoint.includes("{")) {
    // Truncate at first path param — e.g. /users/:id/posts → /users
    testEndpoint = testEndpoint.replace(/\/[:{\[][^/]*.*$/, "");
    if (!testEndpoint) testEndpoint = "/";
  }

  const fullUrl = `${spec.baseUrl}${testEndpoint}`;

  // Safety checks
  if (!isSafeUrl(fullUrl)) {
    return { ok: false, status: 0, latencyMs: 0, error: "Blocked: URL must be HTTPS and not target internal networks" };
  }
  try {
    await assertResolvedIpSafe(fullUrl);
  } catch (dnsErr) {
    return { ok: false, status: 0, latencyMs: 0, error: dnsErr instanceof Error ? dnsErr.message : "DNS check failed" };
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const res = await fetch(fullUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    const body = await res.text().catch(() => "");
    const preview = body.length > 200 ? body.slice(0, 200) + "…" : body;

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        latencyMs,
        error: `${spec.displayName} returned ${res.status} (key: ${maskKey(apiKey)})`,
        preview,
      };
    }

    return { ok: true, status: res.status, latencyMs, preview };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const raw = err instanceof Error ? err.message : String(err);
    // Scrub API key from error messages
    const safeMsg = raw.split(apiKey).join(maskKey(apiKey));
    return { ok: false, status: 0, latencyMs, error: safeMsg };
  }
}
