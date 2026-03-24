---
name: Skill 建立器
description: 當用戶要建立新 skill 時，自動完成完整的建立流程：寫 skill 檔案、加 CLAUDE.md 觸發規則、確認不重複不衝突。
user_invocable: true
trigger: Use this skill when the user asks to create a new skill, add a skill, build a skill, or mentions '建 skill', '新增 skill', '加一個 skill'. Also trigger when user provides a skill spec or workflow and wants it saved as a reusable skill.
---

# Skill 建立器

用戶要建新 skill 時，用這份流程確保每個 skill 都完整、不重複、能被正確觸發。

---

## 流程

### 1. 分析需求

從用戶的描述中提取：

| 要素 | 問題 |
|------|------|
| **目的** | 這個 skill 解決什麼問題？ |
| **觸發條件** | 什麼情境下該自動讀取這個 skill？ |
| **輸入** | 用戶會提供什麼資訊？ |
| **輸出** | 執行完 skill 會產出什麼？ |
| **頻率** | 一次性還是重複使用？（一次性的不該是 skill） |

### 2. 檢查重複

在建立前先確認不跟既有 skill 重疊：

```bash
# 列出所有現有 skill
ls .claude/skills/

# 搜尋相關關鍵字
grep -r "{相關關鍵字}" .claude/skills/
```

如果有重疊：
- **完全重疊** → 不建新的，更新既有 skill
- **部分重疊** → 合併到既有 skill，或拆分職責後再建

### 3. 決定觸發類型

OctoDock 的 skill 有兩種觸發方式：

| 觸發類型 | 判斷標準 | CLAUDE.md 寫法 | 範例 |
|----------|---------|----------------|------|
| **檔案路徑觸發** | 改特定檔案時自動檢查 | `修改 src/adapters/*.ts` | adapter-quality-checklist |
| **語意情境觸發** | 用戶提到特定任務/關鍵字 | `用戶提到寫文章、blog` | blog-writer |

判斷方法：
- 跟「寫程式碼 / 改檔案」有關 → 檔案路徑觸發
- 跟「完成特定任務」有關 → 語意情境觸發
- 兩者都有 → 兩種都加

### 4. 寫 Skill 檔案

路徑：`.claude/skills/{skill-name}.md`

**必要結構：**

```markdown
---
name: {中文名稱}
description: {一句話描述，要足夠具體讓觸發判斷能用}
user_invocable: true  ← 如果用戶可以用 /skill-name 手動觸發
trigger: {英文觸發描述，列出關鍵字和排除條件}
---

# {Skill 名稱}

{一段話說明這個 skill 做什麼、什麼時候用}

---

## {主要內容}

{規則、清單、流程、範本等}

---

## 執行時機

| 觸發條件 | 動作 |
|----------|------|
| {條件 1} | {動作 1} |
| {條件 2} | {動作 2} |
```

**Frontmatter 欄位說明：**

| 欄位 | 必填 | 說明 |
|------|------|------|
| `name` | 是 | 中文名稱，簡短明確 |
| `description` | 是 | 一句話描述用途，用於觸發判斷 |
| `user_invocable` | 否 | 設 `true` 讓用戶能手動觸發 |
| `trigger` | 否 | 英文的觸發描述（關鍵字 + 排除條件），給 Claude Code 判斷用 |

### 5. 更新 CLAUDE.md 觸發表格

在 `### Skills（if-then 規則 + hook 雙層觸發）` 的表格裡加一行：

```markdown
| {觸發條件} | `.claude/skills/{skill-name}.md` | {說明} |
```

**規則：**
- 觸發條件要具體，不要寫「任何情況」
- 說明要一句話講完，不要超過 20 字
- 檔案路徑觸發的條件寫檔案 pattern（如 `修改 src/app/`）
- 語意觸發的條件寫用戶意圖（如 `用戶提到寫文章、blog`）

### 6. 驗證

建完後快速驗證：

- [ ] Skill 檔案存在且格式正確（frontmatter + 內容）
- [ ] CLAUDE.md 表格有對應的觸發規則
- [ ] 不跟既有 skill 重複或衝突
- [ ] 觸發條件夠具體（不會誤觸發）
- [ ] 排除條件有寫（避免不該觸發的場景）
- [ ] 內容足夠完整，下次觸發時不需要再問用戶補充

---

## 品質標準

好的 skill：
- **可重複** — 不是一次性的操作，是會反覆遇到的情境
- **可觸發** — 觸發條件明確，不需要用戶記得手動觸發
- **自足** — 讀完 skill 就知道該怎麼做，不需要額外問人
- **可演進** — 有回饋機制（如 self-improve.md 會檢查是否需要更新）

壞的 skill：
- 只用一次就不用了 → 不該是 skill，寫在對話或文件裡就好
- 觸發條件太模糊（「任何開發工作」）→ 每次都會觸發，等於沒有觸發
- 內容太籠統（「注意品質」）→ 沒有具體可執行的檢查項
- 跟既有 skill 大量重疊 → 應該合併而不是新建
