# OctoDock

> One URL. All Apps. Remembers You.

所有原則、流程、認知都在五個主 Skill 中。CLAUDE.md 只負責路由。

## 協作準則

**理解意圖，而非照搬字面。** 用戶的表述未必精確對應其真實需求。收到指令後，先推敲背後的意圖與脈絡，重新定位問題的本質，再決定行動方向。

**所有提問皆為善意。** 用戶不會以反問或嘲諷的方式溝通。當用戶對你的產出提出疑問時，區分兩種情境：一是對資訊正確性的質疑（應重新驗證後修正），二是純粹的求知（應直接解答）。不要防禦性回應。

**論述必須有據。** 所有判斷和建議須以實際程式碼、資料、或可溯源的事實為依據，不得基於未經驗證的假設。陳述因果關係時交代推導過程。避免比喻，用精確的邏輯表達。

**凡事過猶不及。** 判斷無需動作時，不動作即為正確產出。不為了展示勤奮而製造變更，不為了填滿回應而添加冗餘。每一次行動都應有明確理由，沒有理由就停手。

**OctoDock 只做兩種優化。** 一、讓 AI 透過 OctoDock 自身的功能更好地使用 App（param-guard 轉換、pre-context 補現狀、error-hints 引導修正、回傳壓縮等）。二、透過觀察 AI 實際操作 App 的狀況，進行針對性的專屬優化（從 operations 數據找失敗模式、學習錯誤、偵測工作流等）。不做超出這兩個方向的事。

## 五個主 Skill 的職責邊界

| Skill | 一句話職責 | 產出 | 不負責 |
|-------|-----------|------|--------|
| **開發** | 功能開發 + API 研究 + 數據驅動改善 | 程式碼、API 評估、基於數據的改善 | 不負責判斷該不該做（思考的事）|
| **審查** | 確認產出是否正確、完整、合理 | 問題清單（必修/建議/觀察） | 不負責修，只負責發現和判定 |
| **維護** | 讓系統保持在可安心改動的狀態 | 健康度報告、清理、更新 | 不負責新功能，只負責現有系統 |
| **思考** | 全貌理解、方向評估、問題分析、決策、反思、對話摘要 | 決策、方向建議、反思結論、對話摘要 | 不負責執行，不負責管理 |
| **優化** | skill/記憶/工作流程/CLAUDE.md 管理 | 增刪調整、結構精簡、流程改善 | 不負責問題分析與決策 |

### 交接規則

```
思考 →「該怎麼做」→ 開發（思考產出決策，開發執行決策）
開發 →「做完了」→ 審查（開發產出程式碼，審查驗證品質）
審查 →「這裡有問題」→ 開發（審查發現問題，開發去修）
維護 →「系統這裡退化了」→ 開發（維護發現問題，開發去修）
維護 →「為什麼反覆出現」→ 思考（維護發現模式，思考找根因）
任何 skill →「流程效率有問題」→ 優化（改善流程效率）
任何 skill →「結構冗餘或過度設計」→ 優化（精簡 CLAUDE.md 和 skill）
commit 後 → 思考（反思對話與任務，決定認知沉澱）→ 優化（確保載體結構乾淨）
```

## Skill 觸發索引

開始工作前，根據要做的事載入對應的 skill。五個主 skill 涵蓋所有工作類型，子 skill 處理特定場景。

### 主 Skill

| 觸發條件 | Skill |
|----------|-------|
| 開發新功能、修 bug、重構、production 事故 | `.claude/skills/dev-flow.md` |
| 開發完成、提交前、重大變更前、定期稽核 | `.claude/skills/review.md` |
| 定期維護、系統健康度檢查、資料完整性稽核 | `.claude/skills/maintenance-flow.md` |
| 面對非 trivial 問題、架構決策、根因分析、認知沉澱、commit 後反思 | `.claude/skills/thinking.md` |
| skill/記憶/工作流程/CLAUDE.md 管理、流程效率改善、發現冗餘或過度設計 | `.claude/skills/optimize.md` |

### 子 Skill（特定場景）

| 觸發條件 | Skill |
|----------|-------|
| 寫程式碼（編碼慣例、品質標準、資料流規則） | `.claude/skills/implementation-rules.md` |
| 改 adapter | `.claude/skills/adapter-quality-checklist.md` |
| 新增 App | `.claude/skills/new-app-research.md` |
| 後端變更 | `.claude/skills/frontend-sync.md` |
| 改前端 | `.claude/skills/ui-review.md`、`.claude/skills/visual-design.md` |
| 3 個以上檔案改動 | `.claude/skills/planning-doc.md` |
| 設定 App 認證 | `.claude/skills/setup-guide.md` |
| 寫 Blog | `.claude/skills/blog-writer.md` |
| 建新 skill | `.claude/skills/skill-builder.md` |
| commit | `.claude/skills/commit.md` |

## Blog 文章

寫作規則存在 Notion 頁面 `32ba9617-875f-81a4-a751-cbc0b7668487`。執行 Blog 相關任務前，先讀這個頁面拿最新規則。

---

規劃文件在 `docs/`。Hook `.claude/hooks/post-commit-check.sh` 會在 commit 後根據改動自動提醒。Claude Code memory 不進 repo，需要持久化的知識寫 skills。
