"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

/* ── AI Prompt 模板（開發者複製給 AI 用） ── */
function buildPrompt(appName: string, apiDocsUrl: string, authType: string): string {
  const authLabel =
    authType === "oauth_own" ? "OAuth 2.0 (developer-provided)"
    : authType === "api_key" ? "API Key / Bot Token"
    : "OAuth 2.0 (OctoDock will create the OAuth App)";

  const name = appName || "[APP_NAME]";

  return `I need to write an adapter spec for integrating "${name}" with OctoDock, a unified MCP server that lets AI agents operate multiple apps through two tools: octodock_do(app, action, params) and octodock_help(app, action).

API documentation: ${apiDocsUrl || "[PASTE_API_DOCS_URL_HERE]"}

## What OctoDock needs from each adapter

Each adapter defines:
1. **actionMap** — maps simple action names (e.g. "publish") to internal tool names (e.g. "threads_publish")
2. **actions** — each action's API endpoint, HTTP method, parameters, and how to format the response for AI
3. **skill descriptions** — short help text shown when AI calls octodock_help(app, action)
4. **error hints** — common API errors mapped to user-friendly messages

## Output format

Generate a JSON spec with this structure:

{
  "appName": "${name}",
  "displayName": "${name}",
  "authType": "${authLabel}",
  "baseUrl": "https://api.example.com",
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
  "authType": "OAuth 2.0",
  "baseUrl": "https://graph.threads.net/v1.0",
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

Output ONLY the JSON code block, no extra explanation.`;
}

export function DevelopersClient() {
  const { t } = useI18n();
  /* 當前 tab */
  const [tab, setTab] = useState<"request" | "submit">("request");
  /* 表單狀態 */
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);
  const [copied, setCopied] = useState(false);

  /* Request 表單 */
  const [reqAppName, setReqAppName] = useState("");
  const [reqReason, setReqReason] = useState("");
  const [reqEmail, setReqEmail] = useState("");

  /* Submit 表單 */
  const [subAppName, setSubAppName] = useState("");
  const [subApiDocs, setSubApiDocs] = useState("");
  const [subEmail, setSubEmail] = useState("");
  const [subAuthType, setSubAuthType] = useState("oauth_octodock");
  const [subAuthDetails, setSubAuthDetails] = useState("");
  const [subSpec, setSubSpec] = useState("");

  /* 送出 */
  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setResult(null);

    const body = tab === "request"
      ? { type: "request", appName: reqAppName, email: reqEmail, reason: reqReason }
      : { type: "submit", appName: subAppName, email: subEmail, apiDocsUrl: subApiDocs, authType: subAuthType, authDetails: subAuthDetails, adapterSpec: subSpec };

    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setResult("success");
        /* 清空表單 */
        if (tab === "request") { setReqAppName(""); setReqReason(""); setReqEmail(""); }
        else { setSubAppName(""); setSubApiDocs(""); setSubEmail(""); setSubAuthDetails(""); setSubSpec(""); }
      } else {
        setResult("error");
      }
    } catch {
      setResult("error");
    } finally {
      setSubmitting(false);
    }
  }, [tab, reqAppName, reqReason, reqEmail, subAppName, subApiDocs, subEmail, subAuthType, subAuthDetails, subSpec]);

  /* 複製 prompt（用 ref 追蹤 timer，避免 memory leak） */
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimerRef.current), []);

  const copyPrompt = useCallback(() => {
    navigator.clipboard.writeText(buildPrompt(subAppName, subApiDocs, subAuthType));
    setCopied(true);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [subAppName, subApiDocs, subAuthType]);

  /* spec JSON 驗證 */
  const [specError, setSpecError] = useState<string | null>(null);

  /** 驗證 adapter spec 的格式和必要欄位 */
  const validateSpec = useCallback((raw: string): string | null => {
    if (!raw.trim()) return null; // 還沒填，不顯示錯誤

    // 自動去除 markdown code fence（AI 常包一層 ```json ... ```）
    const cleaned = raw.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return t("dev.submit.spec_error_json");
    }

    if (!parsed.appName && !parsed.app_name) return t("dev.submit.spec_error_app_name");
    const actions = parsed.actions;
    if (!Array.isArray(actions) || actions.length === 0) return t("dev.submit.spec_error_actions");

    // 檢查每個 action 的基本結構
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i] as Record<string, unknown>;
      if (!a.name) return t("dev.submit.spec_error_action_name").replace("{i}", String(i + 1));
    }

    return null; // 驗證通過
  }, [t]);

  /* 前端表單驗證：必填欄位是否填了 + spec 格式正確 */
  const isFormValid = tab === "request"
    ? !!(reqAppName.trim() && reqReason.trim() && reqEmail.trim())
    : !!(subAppName.trim() && subApiDocs.trim() && subEmail.trim() && subSpec.trim() && !specError);

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      {/* Header */}
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-4 flex items-center justify-between">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 no-underline">
          {t("dev.nav.back")}
        </Link>
        <LanguageSwitcher />
      </div>

      {/* 標題 */}
      <div className="max-w-2xl mx-auto px-4 pb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t("dev.page_title")}</h1>
        <p className="text-gray-500 mt-1 text-sm">{t("dev.page_desc")}</p>
      </div>

      {/* Tab 切換 */}
      <div className="max-w-2xl mx-auto px-4">
        <div className="flex border-b border-gray-200 mb-6">
          <button
            onClick={() => { setTab("request"); setResult(null); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "request"
                ? "border-[#1D9E75] text-[#1D9E75]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t("dev.tab_request")}
          </button>
          <button
            onClick={() => { setTab("submit"); setResult(null); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "submit"
                ? "border-[#1D9E75] text-[#1D9E75]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t("dev.tab_submit")}
          </button>
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
              <input
                type="text"
                value={reqAppName}
                onChange={(e) => setReqAppName(e.target.value)}
                placeholder={t("dev.request.app_name_placeholder")}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("dev.request.reason")}</label>
              <textarea
                value={reqReason}
                onChange={(e) => setReqReason(e.target.value)}
                placeholder={t("dev.request.reason_placeholder")}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75] resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("dev.request.email")}</label>
              <input
                type="email"
                value={reqEmail}
                onChange={(e) => setReqEmail(e.target.value)}
                placeholder={t("dev.request.email_placeholder")}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75]"
              />
            </div>
          </div>
        )}

        {/* ═══════════════ Tab B: 提交 Adapter ═══════════════ */}
        {tab === "submit" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t("dev.submit.title")}</h2>
              <p className="text-sm text-gray-500 mt-1">{t("dev.submit.desc")}</p>
            </div>

            {/* 基本資訊 */}
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("dev.submit.app_name")}</label>
                <input
                  type="text"
                  value={subAppName}
                  onChange={(e) => setSubAppName(e.target.value)}
                  placeholder="Trello"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("dev.submit.api_docs")}</label>
                <input
                  type="url"
                  value={subApiDocs}
                  onChange={(e) => setSubApiDocs(e.target.value)}
                  placeholder={t("dev.submit.api_docs_placeholder")}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("dev.submit.email")}</label>
                <input
                  type="email"
                  value={subEmail}
                  onChange={(e) => setSubEmail(e.target.value)}
                  placeholder="dev@example.com"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75]"
                />
              </div>
            </div>

            {/* 認證方式 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t("dev.submit.auth_type")}</label>
              <div className="space-y-2">
                {[
                  { value: "oauth_own", label: t("dev.submit.auth_oauth") },
                  { value: "api_key", label: t("dev.submit.auth_apikey") },
                  { value: "oauth_octodock", label: t("dev.submit.auth_octodock") },
                ].map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="authType"
                      value={opt.value}
                      checked={subAuthType === opt.value}
                      onChange={(e) => setSubAuthType(e.target.value)}
                      className="accent-[#1D9E75]"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {/* OAuth 細節（僅 oauth_own 時顯示） */}
            {subAuthType === "oauth_own" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("dev.submit.auth_details")}</label>
                <textarea
                  value={subAuthDetails}
                  onChange={(e) => setSubAuthDetails(e.target.value)}
                  placeholder={t("dev.submit.auth_details_placeholder")}
                  rows={3}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D9E75] resize-none"
                />
              </div>
            )}

            {/* 第一步：複製 Prompt */}
            <div className="bg-white border rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">{t("dev.submit.prompt_title")}</h3>
              <p className="text-xs text-gray-500 mb-3">{t("dev.submit.prompt_desc")}</p>
              <pre className="bg-gray-50 border rounded p-3 text-xs text-gray-700 overflow-x-auto max-h-48 whitespace-pre-wrap">
                {buildPrompt(subAppName, subApiDocs, subAuthType)}
              </pre>
              <button
                onClick={copyPrompt}
                className="mt-2 px-3 py-1.5 text-xs bg-[#1D9E75] text-white rounded-lg hover:bg-[#0F6E56] transition-colors"
              >
                {copied ? t("dev.submit.copied") : t("dev.submit.copy_prompt")}
              </button>
            </div>

            {/* 第二步：貼上 AI 生成的規格 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("dev.submit.spec_title")}</label>
              <textarea
                value={subSpec}
                onChange={(e) => {
                  setSubSpec(e.target.value);
                  setSpecError(validateSpec(e.target.value));
                }}
                placeholder={t("dev.submit.spec_placeholder")}
                rows={10}
                className={`w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 resize-none ${
                  specError ? "border-red-400 focus:ring-red-300" : "focus:ring-[#1D9E75]"
                }`}
              />
              {specError && (
                <p className="mt-1 text-xs text-red-500">{specError}</p>
              )}
              {subSpec.trim() && !specError && (
                <p className="mt-1 text-xs text-green-600">{t("dev.submit.spec_valid")}</p>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════ 送出按鈕 + 結果 ═══════════════ */}
        <div className="mt-6 pb-16">
          <button
            onClick={handleSubmit}
            disabled={submitting || !isFormValid}
            className="w-full py-2.5 bg-[#1D9E75] text-white rounded-lg text-sm font-medium hover:bg-[#0F6E56] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? t("dev.common.submitting") : t("dev.common.submit")}
          </button>

          {result === "success" && (
            <p className="mt-3 text-sm text-green-600 text-center">{t("dev.common.success")}</p>
          )}
          {result === "error" && (
            <p className="mt-3 text-sm text-red-500 text-center">{t("dev.common.error")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
