#!/bin/bash
# OctoDock post-commit check — 根據改動的檔案觸發對應 skill 提醒

CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null)
[ -z "$CHANGED" ] && exit 0

# ── Adapter 品質檢查 ──
# 新增或修改 adapter 時提醒
if echo "$CHANGED" | grep -q "src/adapters/"; then
  echo "🐙 [Adapter 品質檢查] adapter 有變更 — 請讀取 .claude/skills/adapter-quality-checklist.md 逐項檢查（G1 格式轉換、G2 CRUD 閉環、G3 I/O 對稱、B2 help 分層、B3 錯誤引導）"
fi

# ── 前後端同步 ──
# 後端變更（adapter、MCP server、OAuth、DB schema）時提醒前端同步
if echo "$CHANGED" | grep -qE "src/adapters/|src/mcp/|src/auth|src/db/schema"; then
  echo "🐙 [前後端同步] 後端有變更 — 請讀取 .claude/skills/frontend-sync.md 檢查前端是否需要同步（APP_KEYS、i18n、oauth-env）"
fi

# ── 前端 UI 審查 ──
# 前端頁面或元件有變更時提醒
if echo "$CHANGED" | grep -qE "src/app/.*\.(tsx|css)|src/components/"; then
  echo "🐙 [UI 審查] 前端頁面有變更 — 請讀取 .claude/skills/ui-review.md 逐項檢查（視覺一致性、響應式、狀態、回饋、引導、a11y、i18n）"
fi

# ── 架構思維 ──
# 核心架構檔案有變更時提醒
if echo "$CHANGED" | grep -qE "src/mcp/server\.ts|src/adapters/types\.ts|src/mcp/middleware/"; then
  echo "🐙 [架構思維] 核心架構有變更 — 請讀取 .claude/skills/architecture-thinking.md 確認這是架構層問題還是個別 App 問題"
fi

# ── DB migration 提醒 ──
if git diff HEAD~1 HEAD -- src/db/schema.ts 2>/dev/null | grep -q "^+.*pgTable\|^+.*uuid\|^+.*text("; then
  echo "🐙 DB schema 有新增 — 記得跑 migration"
fi

# ── 自我改進（每次 commit 都提醒）──
echo "🐙 [自我改進] 請讀取 .claude/skills/self-improve.md — 這次改動有沒有值得更新到 CLAUDE.md 或 skills 的經驗？"
