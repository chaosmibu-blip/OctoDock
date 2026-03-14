<p align="center">
  <img src="docs/octodock-mascot.svg" width="280" alt="OctoDock">
</p>

<h1 align="center">OctoDock</h1>

<p align="center">
  <strong>One URL. All Apps. Remembers You.</strong>
</p>

<p align="center">
  Paste one MCP URL into Claude or ChatGPT — your AI can operate all your apps, and it gets smarter the more you use it.
</p>

---

## What is OctoDock?

Most people connect MCP servers one app at a time. Each one dumps 20+ tool definitions into the AI's context window, eating thousands of tokens per turn.

**OctoDock gives your AI just 2 tools:**

| Tool | What it does |
|------|-------------|
| `octodock_do` | Execute any action on any connected app |
| `octodock_help` | Get available apps and actions on demand |

That's ~300 tokens instead of 50,000+. Your AI picks the right action every time because it's choosing from 2, not 65.

### The magic: it remembers you

Every operation flows through OctoDock. Over time, it learns:
- Your Notion folder names → auto-resolves to page IDs
- Your common workflows → suggests shortcuts
- Your preferences → adapts across all AI platforms

Switch from Claude to ChatGPT? Your memory follows you.

## Quick Start

### Self-host

```bash
git clone https://github.com/user/octodock.git
cd octodock
cp .env.example .env    # Edit with your OAuth credentials
docker compose up       # PostgreSQL + pgvector + OctoDock
```

Open `http://localhost:3000`, sign in, connect your apps, copy your MCP URL.

### Generate encryption key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Architecture

```
You → Claude/ChatGPT → octodock_do("notion", "create_page", {title: "Meeting"})
                              ↓
                        OctoDock MCP Server
                              ↓
                  ┌─── Memory Engine (resolves folder name → ID)
                  ├─── Adapter Registry (finds Notion adapter)
                  ├─── OAuth Manager (gets valid token)
                  └─── Notion API → Done
                              ↓
                  { ok: true, url: "https://notion.so/..." }
```

## Connected Apps

| App | Actions | Auth |
|-----|---------|------|
| Notion | 19 | OAuth |
| Gmail | 5 | OAuth |
| LINE | 5 | API Key |
| Telegram | 4 | Bot Token |
| Threads | 5 | OAuth |
| Instagram | 5 | OAuth |

**Adding a new app = adding one file in `src/adapters/`.** The core system auto-discovers it.

## Features

- **2-Tool MCP** — `octodock_do` + `octodock_help`. ~300 tokens vs 50,000+.
- **Memory Engine** — pgvector semantic search. Learns your names, patterns, preferences.
- **Name Resolution** — Say "Meeting Notes" instead of `317a9617-...`. Auto-resolves via memory.
- **Format Conversion** — Reads return Markdown, writes accept Markdown. Symmetric I/O.
- **SOP System** — Markdown workflow documents. AI reads and executes step-by-step.
- **Scheduler** — Cron-based automation. Simple tasks = free. Complex = internal AI (Haiku).
- **Pattern Analyzer** — Auto-detects frequent actions and default folders.

## Tech Stack

TypeScript, Next.js (App Router), PostgreSQL + pgvector, Drizzle ORM, NextAuth.js, AES-256-GCM, @modelcontextprotocol/sdk

## Project Structure

```
src/
├── adapters/           # One file per app (auto-discovered)
├── mcp/
│   ├── server.ts       # octodock_do + octodock_help
│   ├── registry.ts     # Auto-discovery
│   ├── system-actions.ts   # Memory, SOP, scheduler
│   └── pattern-analyzer.ts
├── services/
│   ├── memory-engine.ts    # pgvector + learn/resolve
│   ├── scheduler.ts        # Cron automation
│   └── internal-ai.ts      # Claude Haiku
└── app/                # Next.js routes + Dashboard
```

## Adding a New Adapter

1. Create `src/adapters/your-app.ts`
2. Implement `AppAdapter`: `actionMap`, `getSkill()`, `formatResponse()`, `execute()`
3. Done. Registry auto-discovers it.

See `.claude/skills/adapter-quality-checklist.md` for quality guidelines.

## License

[Business Source License 1.1](LICENSE) — 你可以自由使用、修改、自架，但不能拿去做競品託管服務。4 年後自動轉為 MIT。
