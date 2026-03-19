/**
 * U26a: OctoDock 文件頁面
 * /docs — 供 Claude Connectors Directory 審查用
 */

export const metadata = {
  title: "Documentation - OctoDock",
  description: "OctoDock documentation for developers and users",
};

export default function DocsPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12 prose prose-invert">
      <h1>OctoDock Documentation</h1>

      <section>
        <h2>What is OctoDock?</h2>
        <p>
          OctoDock is a unified MCP (Model Context Protocol) server that connects
          your AI assistants to all your apps through a single URL. Instead of
          configuring multiple integrations, you connect once and every AI agent
          can operate all your authorized apps.
        </p>
      </section>

      <section>
        <h2>Getting Started</h2>
        <ol>
          <li>Sign in with your Google account at <strong>octo-dock.com</strong></li>
          <li>Connect the apps you want to use (Notion, Gmail, Google Calendar, etc.)</li>
          <li>Copy your MCP URL from the dashboard</li>
          <li>Paste it into your AI tool (Claude, ChatGPT, Cursor, etc.)</li>
        </ol>
      </section>

      <section>
        <h2>MCP Tools</h2>
        <p>OctoDock exposes 3 tools to your AI agent (~300 tokens):</p>
        <ul>
          <li>
            <strong>octodock_do(app, action, params)</strong> — Execute any action
            on a connected app
          </li>
          <li>
            <strong>octodock_help(app?, action?)</strong> — Look up available apps,
            actions, and parameters
          </li>
          <li>
            <strong>octodock_sop(category?, name?)</strong> — List and execute saved
            workflows (SOPs)
          </li>
        </ul>
      </section>

      <section>
        <h2>Supported Apps</h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            "Notion", "Gmail", "Google Calendar", "Google Drive",
            "Google Docs", "Google Sheets", "Google Tasks", "YouTube",
            "GitHub", "LINE", "Telegram", "Discord",
            "Slack", "Threads", "Instagram", "Canva",
          ].map((app) => (
            <div key={app} className="px-3 py-1 bg-white/5 rounded text-sm">
              {app}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Memory System</h2>
        <p>
          OctoDock remembers your preferences and usage patterns across different
          AI agents. When you use a name to refer to a Notion page, OctoDock
          learns the mapping and resolves it automatically next time.
        </p>
      </section>

      <section>
        <h2>SOP (Standard Operating Procedures)</h2>
        <p>
          OctoDock automatically detects repeated operation patterns and saves
          them as workflows. You can also create SOPs manually. SOPs persist
          across agents and sessions.
        </p>
      </section>

      <section>
        <h2>Security</h2>
        <ul>
          <li>All OAuth tokens are encrypted with AES-256-GCM at rest</li>
          <li>Tokens are never exposed in logs, responses, or error messages</li>
          <li>Each user has an isolated MCP endpoint with a unique API key</li>
          <li>Per-user rate limiting prevents abuse</li>
          <li>GDPR-compliant: full account deletion available</li>
        </ul>
      </section>

      <section>
        <h2>Links</h2>
        <ul>
          <li><a href="/privacy">Privacy Policy</a></li>
          <li><a href="/terms">Terms of Service</a></li>
          <li><a href="https://github.com/chaosmibu-blip/OctoDock">GitHub Repository</a></li>
        </ul>
      </section>
    </main>
  );
}
