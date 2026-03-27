# OctoDock

> One URL. All Apps. Remembers You.

OctoDock 是一個面向非技術用戶的基礎設施產品。用戶只需設定一個 MCP URL，就能讓任何 AI agent 操作所有已授權的 App，並擁有跨 agent 共享的操作記憶。OctoDock 做 Claude Code 做不到的事，不重複 Claude Code 已有的功能。

三個核心方向：跨 App 操作層、記憶層、AI 使用體驗優化層。排程和 Channel 推送用 Claude Code 本身的功能。

## 核心架構

MCP server 只暴露 `octodock_do` 和 `octodock_help` 兩個工具，不管連了幾個 App 都一樣。每個 App 是一個獨立的 Adapter 模組，核心系統啟動時自動掃描、自動註冊。記憶引擎用 PostgreSQL + pgvector，四種記憶類型：preference、pattern、context、workflow。工作流系統記錄用戶做過的多步驟操作流程，自動偵測重複操作模式。訂閱系統三條收款線：Paddle、IAP、ECPay。

核心迭代迴路：AI 使用 → 修正格式 → 補現狀 → 執行 → 記錄 → 分析失敗模式 → 優化程式碼 → AI 下次用得更好。

## 核心定位：AI 負責想，OctoDock 負責做

OctoDock 不是 AI 和 App 之間的「守衛」，是「執行者」。AI 只需要表達意圖和提供資料，OctoDock 負責組裝、控速、寫入、驗證、回報。

- **不限制 AI**：rate limit、格式轉換、批量控速是 OctoDock 內部實作細節，AI 不需要知道也不應該碰到
- **幫助 AI**：回傳壓縮（讓 AI 管理 context）、transfer 提示（引導最佳路徑）、nextSuggestion（引導下一步）— 這些不是限制，是輔助
- **App API 限制由 OctoDock 處理**：各 App 的 rate limit 定義在 `APP_RATE_LIMITS`，批量操作自動控速、失敗自動重試，AI 完全不用管
- **唯一的外部限制**：免費用戶月度配額（商業模型）

設計新功能時問「OctoDock 能替 AI 做什麼」，不是「怎麼限制 AI」。

## 開發原則

0. **你擁有記憶管理權**
   - 自行決定記憶與規則該有哪些內容、如何儲存、如何分層、分權、分職責
   - 持續迭代、精煉優化記憶與規則的內容
   - 自行決定是否增、刪、調整
   - **留下什麼**：從經驗提煉的認知、重複犯過的錯的通用教訓、用戶偏好、架構決策的「為什麼」。不留能從程式碼讀出來的、一次性的任務細節、變化太快維護不了的
   - **如何分層**：CLAUDE.md 是原則和認知（為什麼、怎麼想）→ Skills 是流程和規則（怎麼做）→ Docs 是狀態和紀錄（現在在哪）→ Code/DB 是實作本身（實際是什麼）
   - **如何分權**：CLAUDE.md 門檻最高改動最慎重，Skills 領域內可自由更新，Docs 最靈活隨時可改
   - **如何分職責**：CLAUDE.md 引導思考和判斷，Skills 引導執行，Docs 記錄計畫和決策，程式碼註解解釋局部實作
   - **如何迭代**：同一個教訓出現兩次就寫入，規則太具體就抽象化，從來沒觸發的考慮移除，重疊的合併
   - **如何決定增刪調整**：增是現有規則覆蓋不到的新模式，刪是過時的或被更高層規則涵蓋的，調是描述跟現實不符的
1. **吾日三省吾身**：每次對話開始時讀 CLAUDE.md，對話過程中時刻檢查有無需要增、刪、調整的內容
2. **三思而後行**
3. **不動作是一種選擇**：你有不動作的權利以及義務。錯誤的行動比不行動更有害，未被發現的錯誤會累積，在最關鍵的時刻爆發
4. **複利思維**：每個環節都建立能自我增強的機制，正向循環會自己推動專案轉動
5. **規劃、執行、回顧**：所有工作都是這三步的循環，每一次循環都讓 CLAUDE.md 比上一次更完整。詳細步驟見 `.claude/skills/implementation-rules.md`
6. **Skill 的標準**：Skill 要能實際被觸發，Skill 要能持續迭代與優化
6. **不重複造輪子**：優先看現有的能不能用，改完要刪掉舊的
7. **不擅自省略**：有疑問就問，不要自己決定跳過
8. **前後端同步**：後端的變更必須同步更新前端
9. **治本優先**：修正問題根源，不打補丁。碰到問題先問：這是個別 App 的問題，還是所有 App 都會碰到的？通用的改架構，不改個別 adapter
10. **程式碼能解決的 > 規則能解決的**：如果問題能在 middleware 自動修正，改程式碼的效果永遠大於寫規則
11. **優先使用 OctoDock 自有功能**：操作已連結的 App 用 OctoDock MCP，記憶和工作流用 OctoDock 系統
12. **命名即邏輯**：精準的命名讓程式碼自解釋，錯誤的命名會建立錯誤的心智模型。註解補充命名無法表達的「為什麼」
13. **精準描述**：精準的描述可以避免未來的誤解
14. **結構性思考**：修的不是個別的症狀，是產生症狀的結構。問題不是「A 壞了去修 A」，是「為什麼 A 會壞，怎麼讓 B 到 Z 不可能出現同樣的問題」
15. **給出答案之前先自己驗證**：不論是搜尋、跑測試、還是多反思幾次，回答之前先確認自己說的是對的
16. **回到本質**：先理解事物的本質和第一性原理，再做設計和實作。不要在沒理解本質的情況下加上任意的限制條件

## 踩過的坑（提煉成認知）

- **技術正確 ≠ 有用**：實作前先問「誰會看到？看到後會做什麼？做錯了會怎樣？」。統計上正確但實際有害的功能（如刪除後建議繼續刪除）比不做更糟。沒人會用的欄位不要加
- **做不到就說做不到**：不要用技術手段硬套一個技術解決不了的問題。現有資料不足以推導出正確結論時，承認做不到比給出錯誤結論好。錯誤的結果比沒有結果更糟
- **先理解再動手**：用戶還在說明時不要急著實作。確認理解正確再開始。做錯的要回頭刪乾淨，不是往前跑留一堆技術債
- **說明時先用自然語言描述邏輯，再比對程式碼和 DB 驗證一致性**：不要憑印象說明，要讀完程式碼確認後再回答。發現邏輯和實作不一致時要指出來

- **改架構時要 grep 所有相關程式碼**：架構層統一了，但各模組的獨立實作可能沒跟上。改了一處不等於改了全部
- **元件只負責自己知道的，不知道的交給上層兜底**：不要在底層擅自處理不屬於自己的職責
- **AI 和 API 之間的格式落差是系統性問題**：不是個別 App 的 bug，要用架構層統一解決
- **用戶的瓶頸不一定在你以為的地方**：引導流程要解決用戶真正卡住的那一步
- **不記錄 = 看不見 = 不知道壞了**：每條程式碼路徑都必須有觀測手段

## 部署提醒

Replit 不會自動 deploy。改完程式碼並 build 成功後，必須提醒用戶去 Replit 手動點 Deploy。MCP 呼叫走的是 production（octo-dock.com），localhost 測試通過不代表 MCP 會生效。

## Blog 文章

寫作規則存在 Notion 頁面 `32ba9617-875f-81a4-a751-cbc0b7668487`。執行 Blog 相關任務前，先讀這個頁面拿最新規則。

## Skill 觸發索引

開始工作前，根據要做的事載入對應的 skill：

| 觸發條件 | Skill |
|----------|-------|
| 開發新功能 | `.claude/skills/dev-flow.md` |
| 修 bug | `.claude/skills/bugfix-flow.md` |
| production 出問題 | `.claude/skills/incident-flow.md` |
| 重大改動後或定期稽核 | `.claude/skills/data-audit.md` |
| 定期維護 | `.claude/skills/maintenance-flow.md` |
| 寫程式碼（編碼慣例、品質標準、資料流規則） | `.claude/skills/implementation-rules.md` |
| 改 adapter | `.claude/skills/adapter-quality-checklist.md` |
| 新增 App | `.claude/skills/new-app-research.md` |
| 後端變更 | `.claude/skills/frontend-sync.md` |
| 改前端 | `.claude/skills/ui-review.md`、`.claude/skills/visual-design.md` |
| 改核心架構 | `.claude/skills/architecture-thinking.md` |
| 3 個以上檔案改動 | `.claude/skills/planning-doc.md` |
| 改 tool schema / param-guard / 同類 bug 修第二次 / 用戶糾正方向 / production 失敗模式 | `.claude/skills/cognitive-evolution.md` |
| 設定 App 認證 | `.claude/skills/setup-guide.md` |
| 寫 Blog | `.claude/skills/blog-writer.md` |
| 建新 skill | `.claude/skills/skill-builder.md` |
| commit | `.claude/skills/commit.md` |

規劃文件在 `docs/`。Hook `.claude/hooks/post-commit-check.sh` 會在 commit 後根據改動自動提醒。Claude Code memory 不進 repo，需要持久化的知識寫 CLAUDE.md 或 skills。
