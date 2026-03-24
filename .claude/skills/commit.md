---
name: Commit 完整性檢查
description: 每次 commit 前自動檢查，確保不遺漏檔案、不洩漏敏感資訊、不破壞 build。
user_invocable: true
trigger: Use this skill when the user says 'commit', 'git commit', '提交', or when you are about to create a git commit.
---

# Commit 完整性檢查

每次 commit 前必須跑完這份清單，不能跳過。

---

## 1. 遺漏檔案檢查

```bash
git status
```

**逐項確認：**

- [ ] 所有修改過的檔案（modified）都在 staging area 嗎？
- [ ] 新建的檔案（untracked）該 commit 的都 add 了嗎？
- [ ] 有沒有「改了但忘記 add」的檔案？

**常見遺漏：**

| 後端改動 | 容易漏的前端檔案 |
|----------|----------------|
| 新增 adapter | `dashboard-client.tsx`（APP_KEYS）、`i18n.tsx`、`oauth-env.ts`、`registry.ts`、`action-i18n.ts`、`server.ts`（引導文字） |
| 改 DB schema | migration SQL 檔案 |
| 新增 API route | 對應的前端呼叫程式碼 |
| 安裝 npm 套件 | `package.json` + `package-lock.json` |
| 新增型別定義 | `.d.ts` 檔案 |
| 改 CLAUDE.md | `.claude/skills/` 裡的相關 skill |
| 改 `.env.example` | 對應的程式碼已改成讀環境變數 |
| 新增 shadcn/ui 元件 | `components.json`、`src/components/ui/`、`globals.css`、`lib/utils.ts` |

## 2. 敏感資訊檢查

**對所有即將 commit 的檔案掃描：**

```bash
git diff --cached --name-only  # 列出 staged 的檔案
git diff --cached               # 看完整 diff
```

**搜尋以下 pattern（有任何一個命中就停下來）：**

| 類別 | 搜尋 pattern | 處理方式 |
|------|-------------|---------|
| 真實 email | `@gmail.com`、`@outlook.com`（範例 email 除外） | 移到環境變數或改用 `contact@octo-dock.com` |
| API 密鑰 | `sk-`、`ghp_`、`xoxb-`、長度 > 20 的隨機字串 | 必須從環境變數讀取 |
| DB 連線字串 | `neon.tech`、`postgres://`、`mongodb://` 帶密碼的 | 移到 `DATABASE_URL` 環境變數 |
| 私人 UUID | Notion page/database ID | 評估：公開 blog DB ID 可接受，私人資料不行 |
| Bot Token | `bot[0-9]+:` | 必須加密存儲，不能出現在程式碼 |
| 密碼 | `password = "..."` 帶實際值 | 改成環境變數 |

**自動掃描指令：**

```bash
# 對 staged 的內容掃敏感 pattern
git diff --cached -U0 | grep -iE "@gmail\.com|@outlook\.com|neon\.tech|sk-[a-zA-Z0-9]{20}|ghp_|password\s*=\s*['\"][^'\"]{8}" || echo "Clean"
```

命中任何一個 → **停下來修正後再 commit**，不要跳過。

## 3. Build 檢查

```bash
npx next build 2>&1 | grep -E "^Failed|Type error|Error:"
```

- Build 失敗 → 不 commit
- 有 Type error → 修完再 commit
- Warning 可以接受（但 `any` type 盡量修）

## 4. .gitignore 確認

確認以下檔案/目錄都在 `.gitignore` 裡：

- [ ] `.env`（所有 `.env*`）
- [ ] `.claude/settings.local.json`
- [ ] `.claude/projects/`
- [ ] `.claude/skills/`
- [ ] `node_modules/`
- [ ] `.next/`

如果有新的敏感檔案類型，加到 `.gitignore`。

## 5. Commit 訊息

格式：中文 + Conventional Commits

```
{type}({scope}): {中文摘要}

{可選的詳細說明}

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

**type 對照：**
- `feat` — 新功能
- `fix` — 修 bug
- `refactor` — 重構（不改功能）
- `docs` — 文件
- `style` — 格式（不影響邏輯）
- `chore` — 雜務（依賴更新、設定調整）
- `security` — 安全修復

## 6. 最終確認

commit 完成後跑：

```bash
git status  # 確認沒有遺漏
git log --oneline -1  # 確認 commit 訊息正確
```

如果 `git status` 還有未追蹤或未 staged 的檔案 → 問自己「這個檔案是故意不 commit 的嗎？」

---

## 不該 commit 的檔案

遇到以下檔案直接跳過，不需要問用戶：

| 檔案 | 原因 |
|------|------|
| `.claude/scheduled_tasks.lock` | Claude Code 內部檔案 |
| `.claude/projects/*` | Claude Code memory，已 gitignore |
| `.claude/settings.local.json` | 本地設定，已 gitignore |
| `.claude/skills/*` | 私有 skill，已 gitignore |
| `*.lock`（非 package-lock） | 各工具的 lock 檔案 |
