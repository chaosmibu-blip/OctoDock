/**
 * U26a: OctoDock 文件頁面
 * /docs — 供開發者和 Claude Connectors Directory 審查用
 */
import Link from "next/link";
import { BASE_URL } from "@/lib/constants";

export const metadata = {
  title: "Documentation - OctoDock",
  description: "OctoDock documentation for developers and users",
  alternates: { canonical: `${BASE_URL}/docs` },
};

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-3xl mx-auto">
        {/* 返回首頁 */}
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 no-underline">
          ← Back to OctoDock
        </Link>

        <h1 className="mt-8 text-4xl font-bold text-gray-900">Documentation</h1>
        <p className="mt-2 text-gray-500">Everything you need to get started with OctoDock.</p>

        {/* What is OctoDock */}
        <section className="mt-12">
          <h2 className="text-2xl font-semibold text-gray-900">What is OctoDock?</h2>
          <p className="mt-3 text-gray-600 leading-relaxed">
            OctoDock is a unified MCP (Model Context Protocol) server that connects
            your AI assistants to all your apps through a single URL. Instead of
            configuring multiple integrations, you connect once and every AI agent
            can operate all your authorized apps.
          </p>
        </section>

        {/* Getting Started */}
        <section className="mt-10">
          <h2 className="text-2xl font-semibold text-gray-900">Getting Started</h2>
          <div className="mt-4 grid gap-3">
            {[
              { step: "1", text: "Sign in with your Google account at octo-dock.com" },
              { step: "2", text: "Connect the apps you want to use (Notion, Gmail, Google Calendar, etc.)" },
              { step: "3", text: "Copy your MCP URL from the dashboard" },
              { step: "4", text: "Paste it into your AI tool (Claude, ChatGPT, Cursor, etc.)" },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 text-sm font-semibold flex items-center justify-center">
                  {step}
                </span>
                <span className="text-gray-700">{text}</span>
              </div>
            ))}
          </div>
        </section>

        {/* MCP Tools */}
        <section className="mt-10">
          <h2 className="text-2xl font-semibold text-gray-900">MCP Tools</h2>
          <p className="mt-3 text-gray-600">OctoDock exposes 3 tools to your AI agent (~300 tokens):</p>
          <div className="mt-4 space-y-3">
            {[
              { name: "octodock_do(app, action, params)", desc: "Access all the user's connected apps with cross-session memory and personalized defaults" },
              { name: "octodock_help(app?, action?)", desc: "Load user context, preferences, and connected apps. Call this first at conversation start" },
              { name: "octodock_sop(category?, name?)", desc: "Load and run the user's proven workflows to complete tasks faster" },
            ].map(({ name, desc }) => (
              <div key={name} className="p-4 rounded-lg border border-gray-200 bg-white">
                <code className="text-sm font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">{name}</code>
                <p className="mt-1.5 text-sm text-gray-600">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Supported Apps */}
        <section className="mt-10">
          <h2 className="text-2xl font-semibold text-gray-900">Supported Apps</h2>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              "Notion", "Gmail", "Google Calendar", "Google Drive",
              "Google Docs", "Google Sheets", "Google Tasks", "YouTube",
              "GitHub", "LINE", "Telegram", "Discord",
              "Slack", "Threads", "Instagram", "Canva", "Gamma",
            ].map((app) => (
              <div key={app} className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-700 text-center border border-gray-100">
                {app}
              </div>
            ))}
          </div>
        </section>

        {/* Memory System */}
        <section className="mt-10">
          <h2 className="text-2xl font-semibold text-gray-900">Memory System</h2>
          <p className="mt-3 text-gray-600 leading-relaxed">
            OctoDock remembers your preferences and usage patterns across different
            AI agents. When you use a name to refer to a Notion page, OctoDock
            learns the mapping and resolves it automatically next time.
          </p>
        </section>

        {/* SOP */}
        <section className="mt-10">
          <h2 className="text-2xl font-semibold text-gray-900">SOP (Standard Operating Procedures)</h2>
          <p className="mt-3 text-gray-600 leading-relaxed">
            OctoDock automatically detects repeated operation patterns and saves
            them as workflows. You can also create SOPs manually. SOPs persist
            across agents and sessions.
          </p>
        </section>

        {/* Security */}
        <section className="mt-10">
          <h2 className="text-2xl font-semibold text-gray-900">Security</h2>
          <ul className="mt-4 space-y-2">
            {[
              "All OAuth tokens are encrypted with AES-256-GCM at rest",
              "Tokens are never exposed in logs, responses, or error messages",
              "Each user has an isolated MCP endpoint with a unique API key",
              "Per-user rate limiting prevents abuse",
              "GDPR-compliant: full account deletion available",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-gray-600">
                <span className="text-emerald-500 mt-1">&#10003;</span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Links */}
        <section className="mt-10 pt-8 border-t border-gray-200">
          <div className="flex flex-wrap gap-6 text-sm">
            <Link href="/privacy" className="text-gray-500 hover:text-gray-700 transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-gray-500 hover:text-gray-700 transition-colors">
              Terms of Service
            </Link>
            <a href="https://github.com/chaosmibu-blip/OctoDock" className="text-gray-500 hover:text-gray-700 transition-colors" target="_blank" rel="noopener noreferrer">
              GitHub Repository
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
