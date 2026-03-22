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

  return `I need to write an adapter spec for integrating "${appName || "[APP_NAME]"}" with OctoDock, a unified MCP server that lets AI agents operate multiple apps.

API documentation: ${apiDocsUrl || "[PASTE_API_DOCS_URL_HERE]"}

Please generate an adapter specification in JSON format with the following structure:

{
  "appName": "${appName || "[APP_NAME]"}",
  "authType": "${authLabel}",
  "actions": [
    {
      "name": "action_name",
      "description": "What this action does",
      "method": "GET/POST/PUT/DELETE",
      "endpoint": "/api/path",
      "params": {
        "param_name": { "type": "string", "required": true, "description": "..." }
      },
      "responseFormat": "Description of how to format the response for AI consumption"
    }
  ]
}

Guidelines:
- Cover full CRUD for each resource type (list, get, create, update, delete)
- Use simple action names like "list_tasks", "create_project", "delete_item"
- Include all required AND optional parameters
- For responseFormat, describe how to convert raw API JSON into human-readable text
- Group actions by resource type (e.g., Projects, Tasks, Comments)
- Include 10-30 actions covering the most useful operations

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

  /* 前端表單驗證：必填欄位是否填了 */
  const isFormValid = tab === "request"
    ? !!(reqAppName.trim() && reqReason.trim() && reqEmail.trim())
    : !!(subAppName.trim() && subApiDocs.trim() && subEmail.trim() && subSpec.trim());

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
                onChange={(e) => setSubSpec(e.target.value)}
                placeholder={t("dev.submit.spec_placeholder")}
                rows={10}
                className="w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1D9E75] resize-none"
              />
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
