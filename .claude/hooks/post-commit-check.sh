#!/bin/bash
# OctoDock post-commit check — 只在真正需要時提醒，不製造噪音

CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null)
[ -z "$CHANGED" ] && exit 0

# 只在「新增」adapter 檔案時才提醒前端同步（修改既有的不提醒）
NEW_ADAPTERS=$(git diff --diff-filter=A --name-only HEAD~1 HEAD 2>/dev/null | grep "src/adapters/" | grep -v "types.ts")
if [ -n "$NEW_ADAPTERS" ]; then
  echo "🐙 新增了 adapter — 記得同步：Dashboard APP_KEYS、i18n、oauth-env、registry.ts、.env.example"
fi

# DB schema 有新增欄位/表但沒跑 migration
if git diff HEAD~1 HEAD -- src/db/schema.ts 2>/dev/null | grep -q "^+.*pgTable\|^+.*uuid\|^+.*text("; then
  echo "🐙 DB schema 有新增 — 記得跑 migration"
fi
