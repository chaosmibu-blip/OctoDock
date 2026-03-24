---
name: 工作流程覺察器
description: 每次開始工作前，主動判斷當前情境是否有對應的工作流程（skill）。有就載入執行，沒有就評估是否值得建立。確保每個情境都有適配的最佳實踐。
---

# 工作流程覺察器

開始任何工作前，先問：**「這個情境有沒有已知的最佳流程？」**

---

## 運作方式

```
收到任務
  → Step 1: 情境識別（這是什麼類型的工作？）
  → Step 2: 流程檢索（有沒有對應的 skill？）
    → 有 → 載入該 skill，按流程執行
    → 沒有 → 直接做，做完評估是否值得建 skill
  → Step 3: 執行完畢後回饋
    → 流程順暢 → 不動
    → 流程卡住 → 更新 skill
    → 沒有流程但做得好 → 建新 skill
```

---

## Step 1: 情境識別

從用戶的指令中快速判斷屬於哪種工作情境：

| 情境關鍵字 | 對應 Skill | 說明 |
|-----------|-----------|------|
| 新增 adapter、加 App、串接 | `new-app-research.md` → `adapter-quality-checklist.md` | 先研究 API，再寫 adapter |
| 修改 adapter、改 action、加功能 | `adapter-quality-checklist.md` | G1-G3、B2-B3 品質檢查 |
| 後端變更、MCP、schema | `frontend-sync.md` | 前後端同步檢查 |
| 前端、UI、Dashboard、元件 | `ui-review.md` + `visual-design.md` | UI/UX 審查 + 視覺美學 |
| 架構、middleware、server.ts | `architecture-thinking.md` | 判斷是架構層還是個別 App |
| 寫文章、blog、SEO | `blog-writer.md` | Blog 產生器 |
| 建 skill、加 skill | `skill-builder.md` | Skill 建立器 |
| commit、提交 | `commit.md` | Commit 前完整性檢查 |
| 設定 OAuth、API Key | `setup-guide.md` | 16 個 App 認證設定 |
| 大型任務（3+ 檔案） | `planning-doc.md` | 先寫規劃文件 |
| 覺察新認知、系統優化 | `cognitive-evolution.md` | 認知進化引擎 |
| 查失敗記錄、分析 production | `production-diagnosis.md`（待建） | 查 operations 表分析模式 |

### 無匹配時

如果沒有對應的 skill：
1. **直接做**，不要為了建 skill 而拖延工作
2. 做完後用認知進化引擎（`cognitive-evolution.md`）評估是否值得建 skill
3. 只有**可重複 + 多步驟**的流程才值得建 skill

---

## Step 2: 流程檢索

快速確認 skill 是否存在且最新：

```bash
# 列出所有 skill
ls .claude/skills/

# 用關鍵字搜尋
grep -r "{關鍵字}" .claude/skills/ --include="*.md" -l
```

載入 skill 後，**按 skill 裡的流程做**，不要跳步驟。

---

## Step 3: 執行後回饋

工作完成後，用 10 秒做一個快速判斷：

| 問題 | 如果是 | 動作 |
|------|--------|------|
| 這次的流程有哪裡卡住？ | 有 | 更新對應 skill |
| 有沒有做了一個 skill 沒寫到的步驟？ | 有 | 補充到 skill |
| 這次沒有對應 skill，但做了 3 步以上的流程？ | 有 | 觸發 cognitive-evolution 評估是否建 skill |
| 做完後覺得「早知道就好了」？ | 有 | 寫入 CLAUDE.md 踩過的坑 |
| 都很順？ | 是 | 不動，繼續下一個任務 |

---

## 與其他 skill 的關係

```
工作流程覺察器（本 skill）
  ├── 事前：識別情境 → 檢索對應 skill → 載入執行
  ├── 事中：按 skill 流程做
  └── 事後：回饋 → 觸發認知進化引擎
                      ↓
              cognitive-evolution.md
              ├── 程式碼層優化（param-guard / middleware）
              └── 知識層優化（CLAUDE.md / 建新 skill）
                      ↓
              下次工作流程覺察器能檢索到新 skill
```

---

## 注意事項

- **不要過度流程化**：簡單的 bug fix 不需要走流程，直接修就好
- **不要建一次性 skill**：只用一次的操作不是 skill，是對話紀錄
- **skill 要能被找到**：建完 skill 後必須更新 CLAUDE.md Skills 觸發表格，否則下次覺察器找不到
- **流程 ≠ 限制**：skill 是建議的最佳實踐，不是必須死守的規定。情境不同可以調整
