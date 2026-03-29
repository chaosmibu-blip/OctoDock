"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

/* ── AI Prompt 模板 ── */
function buildPrompt(appName: string): string {
  const name = appName || "[APP_NAME]";

  return `I need to write an adapter spec for integrating "${name}" with OctoDock, a unified MCP server that lets AI agents operate multiple apps through two tools: octodock_do(app, action, params) and octodock_help(app, action).

## What OctoDock needs from each adapter

Each adapter defines:
1. **actionMap** — maps simple action names (e.g. "publish") to internal tool names (e.g. "threads_publish")
2. **actions** — each action's API endpoint, HTTP method, parameters, and how to format the response for AI
3. **auth** — how users authenticate (OAuth 2.0 URLs and scopes, or API Key instructions)
4. **skill descriptions** — short help text shown when AI calls octodock_help(app, action)
5. **error hints** — common API errors mapped to user-friendly messages

## Output format

Generate a JSON spec with this structure:

{
  "appName": "${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}",
  "displayName": "${name}",
  "baseUrl": "https://api.example.com",
  "auth": {
    "type": "oauth2 or api_key",
    "authorizeUrl": "(OAuth only) https://example.com/oauth/authorize",
    "tokenUrl": "(OAuth only) https://example.com/oauth/token",
    "scopes": ["(OAuth only) scope1", "scope2"],
    "headerName": "(API Key only) Header name, e.g. Authorization, X-API-Key, Api-Token",
    "headerFormat": "(API Key only) Value format, e.g. Bearer {key} or just {key}",
    "keyLocation": "(API Key only) header (default) or query",
    "queryParam": "(API Key only, if keyLocation=query) Query param name, e.g. api_key",
    "instructions": "(API Key only) Where to get the API key"
  },
  "actionMap": {
    "simple_action_name": "internal_tool_name"
  },
  "actions": [
    {
      "name": "internal_tool_name",
      "action": "simple_action_name",
      "description": "One-line English description for AI",
      "method": "GET|POST|PUT|PATCH|DELETE",
      "endpoint": "/api/path/:param",
      "params": {
        "param_name": {
          "type": "string|number|boolean|object|array",
          "required": true,
          "description": "What this param does"
        }
      },
      "responseFormat": "Describe how to convert the raw API JSON into a human-readable summary. e.g. 'Return: Done. Post ID: {id}' or 'Return each item as: - {title} (ID: {id}, status: {status})'"
    }
  ],
  "skillOverview": "One-line summary of all actions, shown when AI calls octodock_help(app). e.g. 'publish(text) — publish post | get_posts(limit?) — get recent posts'",
  "errorHints": [
    { "match": "expired|invalid.*token", "hint": "Token expired. Please reconnect ${name} from the Dashboard." },
    { "match": "not found", "hint": "Resource not found. Check if the ID is correct." },
    { "match": "rate|limit", "hint": "Rate limit reached. Please wait and retry." }
  ]
}

## Real example: Threads adapter spec

{
  "appName": "threads",
  "displayName": "Threads",
  "baseUrl": "https://graph.threads.net/v1.0",
  "auth": {
    "type": "oauth2",
    "authorizeUrl": "https://threads.net/oauth/authorize",
    "tokenUrl": "https://graph.threads.net/oauth/access_token",
    "scopes": ["threads_basic", "threads_content_publish", "threads_read_replies", "threads_manage_replies", "threads_manage_insights"]
  },
  "actionMap": {
    "publish": "threads_publish",
    "get_posts": "threads_get_posts",
    "reply": "threads_reply",
    "get_insights": "threads_get_insights",
    "get_profile": "threads_get_profile"
  },
  "actions": [
    {
      "name": "threads_publish",
      "action": "publish",
      "description": "Publish a new text post to Threads",
      "method": "POST",
      "endpoint": "/me/threads + /me/threads_publish (two-step: create container then publish)",
      "params": {
        "text": { "type": "string", "required": true, "description": "Post content (max 500 chars)" }
      },
      "responseFormat": "Return: Done. Post ID: {id}"
    },
    {
      "name": "threads_get_posts",
      "action": "get_posts",
      "description": "Get recent posts from user's Threads account",
      "method": "GET",
      "endpoint": "/me/threads?fields=id,text,timestamp,permalink&limit={limit}",
      "params": {
        "limit": { "type": "number", "required": false, "description": "Number of posts (default 10, max 25)" }
      },
      "responseFormat": "Return each post as: - {text preview max 100 chars}\\n  ID: {id} | {timestamp} | {permalink}"
    },
    {
      "name": "threads_reply",
      "action": "reply",
      "description": "Reply to an existing Threads post",
      "method": "POST",
      "endpoint": "/me/threads + /me/threads_publish (two-step with reply_to_id)",
      "params": {
        "post_id": { "type": "string", "required": true, "description": "ID of the post to reply to" },
        "text": { "type": "string", "required": true, "description": "Reply content" }
      },
      "responseFormat": "Return: Done. Post ID: {id}"
    }
  ],
  "skillOverview": "publish(text) — publish text post | get_posts(limit?) — recent posts | reply(post_id, text) — reply to post | get_insights(post_id) — engagement metrics | get_profile() — user profile",
  "errorHints": [
    { "match": "expired|invalid.*token", "hint": "Token expired. Reconnect Threads from Dashboard." },
    { "match": "not found", "hint": "Post not found. Check if post_id is correct." },
    { "match": "rate|limit", "hint": "Rate limited. Wait and retry." }
  ]
}

## Guidelines
- Cover full CRUD for each resource type (list, get, create, update, delete)
- Use simple, consistent action names: list_X, get_X, create_X, update_X, delete_X
- Internal tool names should be prefixed with the app name: {app}_{action}
- Include ALL required and optional parameters with clear descriptions
- responseFormat must describe how to convert raw JSON to readable text — never say "return raw JSON"
- errorHints: include 3-5 common API error patterns with user-friendly messages
- Include 10-30 actions covering the most useful operations
- Group actions by resource type in the array
- auth section must include real OAuth URLs/scopes or API key instructions for this specific app

Output ONLY the JSON code block, no extra explanation.`;
}

export function DevelopersClient() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"request" | "submit">("request");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  /* Request 表單 */
  const [reqAppName, setReqAppName] = useState("");
  const [reqReason, setReqReason] = useState("");
  const [reqEmail, setReqEmail] = useState("");

  /* Submit 表單 */
  const [subAppName, setSubAppName] = useState("");
  const [subEmail, setSubEmail] = useState("");
  const [subSpec, setSubSpec] = useState("");

  /* 送出 request */
  const handleRequest = useCallback(async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "request", appName: reqAppName, email: reqEmail, reason: reqReason }),
      });
      if (res.ok) {
        setResult({ type: "success" });
        setReqAppName(""); setReqReason(""); setReqEmail("");
      } else { setResult({ type: "error" }); }
    } catch { setResult({ type: "error" }); }
    finally { setSubmitting(false); }
  }, [reqAppName, reqReason, reqEmail]);

  /* 提交審核 */
  const handleSubmitReview = useCallback(async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "submit", appName: subAppName, email: subEmail, adapterSpec: subSpec }),
      });
      if (res.ok) {
        setResult({ type: "success", message: t("dev.submit.review_submitted") });
        setSubAppName(""); setSubEmail(""); setSubSpec(""); setSpecError(null);
      } else { setResult({ type: "error" }); }
    } catch { setResult({ type: "error" }); }
    finally { setSubmitting(false); }
  }, [subAppName, subEmail, subSpec, t]);

  /* 複製 prompt */
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimerRef.current), []);
  const copyPrompt = useCallback(() => {
    navigator.clipboard.writeText(buildPrompt(subAppName));
    setCopied(true);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [subAppName]);

  /* spec JSON 驗證 */
  const [specError, setSpecError] = useState<string | null>(null);
  const validateSpec = useCallback((raw: string): string | null => {
    if (!raw.trim()) return null;
    const cleaned = raw.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(cleaned); } catch { return t("dev.submit.spec_error_json"); }
    if (!parsed.appName && !parsed.app_name) return t("dev.submit.spec_error_app_name");
    if (!Array.isArray(parsed.actions) || parsed.actions.length === 0) return t("dev.submit.spec_error_actions");
    for (let i = 0; i < parsed.actions.length; i++) {
      const a = parsed.actions[i] as Record<string, unknown>;
      if (!a.name) return t("dev.submit.spec_error_action_name").replace("{i}", String(i + 1));
    }
    return null;
  }, [t]);

  const specValid = subSpec.trim() && !specError;

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-4 flex items-center justify-between">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 no-underline">
          {t("dev.nav.back")}
        </Link>
        <LanguageSwitcher />
      </div>

      <div className="max-w-2xl mx-auto px-4 pb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t("dev.page_title")}</h1>
        <p className="text-gray-500 mt-1 text-sm">{t("dev.page_desc")}</p>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* Tab 切換 */}
        <div className="flex border-b border-gray-200 mb-6">
          {(["request", "submit"] as const).map((key) => (
            <button
              key={key}
              onClick={() => { setTab(key); setResult(null); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? "border-[#1D9E75] text-[#1D9E75]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t(`dev.tab_${key}`)}
            </button>
          ))}
        </div>

        {/* ═══════════════ Tab A: 許願 App ═══════════════ */}
        {tab === "request" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t("dev.request.title")}</h2>
              <p className="text-sm text-gray-500 mt-1">{t("dev.request.desc")}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("dev.request.app_name")}</label>
              <input type="text" value={reqAppName} onChange={(e) => setReqAppName(e.target.value)}
                placeholder={t("dev.request.app_name_placeholder")}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("dev.request.reason")}</label>
              <textarea value={reqReason} onChange={(e) => setReqReason(e.target.value)}
                placeholder={t("dev.request.reason_placeholder")} rows={3}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75] resize-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("dev.request.email")}</label>
              <input type="email" value={reqEmail} onChange={(e) => setReqEmail(e.target.value)}
                placeholder={t("dev.request.email_placeholder")}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75]" />
            </div>
            <button onClick={handleRequest}
              disabled={submitting || !reqAppName.trim() || !reqReason.trim() || !reqEmail.trim()}
              className="w-full py-2.5 bg-[#1D9E75] text-white rounded-lg text-sm font-medium hover:bg-[#0F6E56] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? t("dev.common.submitting") : t("dev.common.submit")}
            </button>
          </div>
        )}

        {/* ═══════════════ Tab B: 建立 Adapter ═══════════════ */}
        {tab === "submit" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t("dev.submit.title")}</h2>
              <p className="text-sm text-gray-500 mt-1">{t("dev.submit.desc")}</p>
            </div>

            {/* 步驟 ① App 名稱 + Email */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("dev.submit.app_name")}</label>
                <input type="text" value={subAppName} onChange={(e) => setSubAppName(e.target.value)}
                  placeholder="Trello"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("dev.submit.email")}</label>
                <input type="email" value={subEmail} onChange={(e) => setSubEmail(e.target.value)}
                  placeholder="dev@example.com"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75]" />
              </div>
            </div>

            {/* 步驟 ② 複製 Prompt */}
            <div className="bg-white border rounded-lg p-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-gray-900">{t("dev.submit.prompt_title")}</h3>
                <button onClick={copyPrompt}
                  className="px-3 py-1.5 text-xs bg-[#1D9E75] text-white rounded-lg hover:bg-[#0F6E56] transition-colors">
                  {copied ? t("dev.submit.copied") : t("dev.submit.copy_prompt")}
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-3">{t("dev.submit.prompt_desc")}</p>
              <pre className="bg-gray-50 border rounded p-3 text-xs text-gray-700 overflow-x-auto max-h-48 whitespace-pre-wrap">
                {buildPrompt(subAppName)}
              </pre>
            </div>

            {/* 步驟 ③ 貼上結果 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("dev.submit.spec_title")}</label>
              <textarea value={subSpec}
                onChange={(e) => { setSubSpec(e.target.value); setSpecError(validateSpec(e.target.value)); }}
                placeholder={t("dev.submit.spec_placeholder")} rows={10}
                className={`w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 resize-none ${
                  specError ? "border-red-400 focus:ring-red-300" : "focus:ring-[#1D9E75]"
                }`} />
              {specError && <p className="mt-1 text-xs text-red-500">{specError}</p>}
              {specValid && <p className="mt-1 text-xs text-green-600">{t("dev.submit.spec_valid")}</p>}
            </div>

            {/* 提交審核 */}
            <button onClick={handleSubmitReview}
              disabled={submitting || !specValid || !subAppName.trim() || !subEmail.includes("@")}
              className="w-full py-2.5 bg-[#1D9E75] text-white rounded-lg text-sm font-medium hover:bg-[#0F6E56] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? t("dev.common.submitting") : t("dev.submit.submit_review")}
            </button>
          </div>
        )}
        {/* 結果訊息 */}
        {result && (
          <div className={`mt-4 p-3 rounded-lg text-sm text-center ${
            result.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
          }`}>
            {result.message || (result.type === "success" ? t("dev.common.success") : t("dev.common.error"))}
          </div>
        )}

        <div className="pb-16" />
      </div>
    </div>
  );
}
