---
name: 認知進化引擎
description: 當工作過程中產生了「對未來同類工作有價值的新理解」時，判斷它該沉澱在哪裡：能用程式碼自動解決的改程式碼（param-guard / middleware）；不能自動化的寫入 CLAUDE.md 開發原則或踩過的坑；需要多步驟流程的建 skill。典型情境：修了第二次同類 bug、用戶糾正了做法、查 production 數據發現模式、做完後覺得「早知道就好了」。
---

# 認知進化引擎

OctoDock 的核心使命：**讓 AI 越用越好用。**

這不只是寫規則文件，而是一個完整的迴路：

```
AI 使用 OctoDock → 成功/失敗記錄到 operations
  → 分析失敗模式 → 優化程式碼（param-guard / middleware / adapter）
  → 提煉通用認知 → 寫入 CLAUDE.md / 建 skill
  → 下次 AI 使用時自動受益
```

---

## 觸發時機

**具體的 if-then 規則，不靠「覺察」：**

| 當你做了這件事 | 立刻檢查 |
|--------------|---------|
| 改了 `server.ts` 的 tool schema（z.object 參數定義） | operations 表有沒有對應欄位？logOperation 有沒有傳？ |
| 在 adapter 裡做了格式轉換（日期、字串→物件等） | 這個轉換該不該提升到 param-guard？其他 App 有沒有同樣問題？ |
| 修了一個 bug，而且這類 bug 之前修過 | 升級到架構層（middleware / param-guard / CLAUDE.md 開發原則） |
| 用戶說「不對」「不是這樣」「改回去」 | 寫入 CLAUDE.md 開發原則或踩過的坑 |
| 查 production 數據發現失敗模式 | 先改程式碼修復 → 再寫 CLAUDE.md |
| 加了新的提前返回路徑（return before executeWithMiddleware） | 有沒有 logOperation？有沒有帶所有必填欄位？ |
| 新增 MCP 參數 | DB schema + migration + logOperation + 所有呼叫點都要同步 |

**不觸發：** 單純修 typo、只改一個 adapter 的孤立 bug、例行 CRUD。

---

## 兩個優化層面

### 層面 A：程式碼層優化（讓系統自動做得更好）

這是最有價值的，因為改一次就永久生效。

| 優化目標 | 對應元件 | 做什麼 |
|---------|---------|-------|
| **AI 傳錯格式** | `param-guard.ts` | 加自動轉換規則（J3e-J3h），不讓錯誤到達 API |
| **AI 不知道怎麼填參數** | `action-chain.ts` | 從歷史成功操作學習，提供 param 建議 |
| **AI 看不懂錯誤訊息** | `error-hints.ts` + adapter `formatError()` | 把 API 錯誤翻譯成可執行的修正指引 |
| **AI 不知道目標現狀** | `pre-context.ts` | 操作前自動查現狀，避免盲目操作 |
| **AI 重複犯同樣的錯** | `error-learner.ts` | 記住失敗模式，下次 pre-context 提前警告 |
| **失敗沒被記錄** | `server.ts` logOperation | 所有提前返回都要記錄，否則無法分析 |
| **操作成功但結果不好** | `post-check.ts` | 偵測修正行為模式（快速 replace = 不滿意） |

**判斷流程：**

```
觀察到問題
  → 這個問題能用程式碼自動解決嗎？
    → 能 → 改程式碼（param-guard / middleware / adapter）
    → 不能 → 進入層面 B（知識層）
```

### 層面 B：知識層優化（讓開發者做得更好）

改 CLAUDE.md 和 skill，影響的是「下次開發時的決策品質」。

| 認知分類 | 判斷標準 | 寫入位置 |
|---------|---------|---------|
| **架構原則** | 所有 App / 所有開發都適用 | CLAUDE.md `開發原則` |
| **技術陷阱** | 具體的坑 + 解法 | CLAUDE.md `踩過的坑` |
| **多步驟流程** | 需要清單或流程圖 | 新建 `.claude/skills/` |
| **品質檢查項** | 可逐項勾選的標準 | 更新既有 skill |
| **用戶偏好** | 特定用戶的做事方式 | OctoDock memory（不進 repo） |

---

## 認知提煉流程

### Step 1: 觀察

```
- AI 在哪一步失敗了？失敗率多高？（查 operations 表）
- AI 重試了幾次才成功？（查同一 session 的操作序列）
- 有沒有 AI 永遠學不會的格式問題？（param-guard 應該攔截）
- 用戶有沒有糾正 AI 的做法？（行為模式改變的信號）
```

### Step 2: 判斷優先級

**程式碼能解決的 > 規則能解決的 > 需要人判斷的**

| 優先級 | 類型 | 範例 |
|--------|------|------|
| P0 | 程式碼自動修正 | param-guard 加轉換規則 |
| P1 | 錯誤訊息改善 | formatError 回傳可執行指引 |
| P2 | CLAUDE.md 新原則 | 開發原則 #12: param-guard 做轉換 |
| P3 | 新建/更新 skill | 適用於多步驟流程 |

### Step 3: 提煉公式

**{什麼情境} + {具體做法} + {為什麼}**

```
✅ 好：「AI 傳 start/end 為字串時，param-guard 自動包成 {dateTime} 物件，因為 GCal API 只認物件格式」
❌ 壞：「要注意日期格式」（沒有情境、沒有做法）
```

### Step 4: 執行

1. **程式碼改動** → 改完 build → 測試 → 記錄到 CLAUDE.md 踩過的坑
2. **CLAUDE.md 更新** → 開發原則 / 踩過的坑 / 架構說明
3. **Skill 建立/更新** → 用 `skill-builder.md` 流程
4. **驗證一致性** → CLAUDE.md 描述 = 實際程式碼

---

## OctoDock 迭代迴路全景

```
┌─────────────────────────────────────────────────────┐
│                AI 使用 OctoDock                      │
│  octodock_do(app, action, params, intent)            │
└──────────────┬──────────────────────────────────────┘
               │
    ┌──────────▼──────────┐
    │   param-guard.ts    │ ← 格式轉換（J3e-J3h）
    │   自動修正參數格式    │ ← 必填參數檢查
    └──────────┬──────────┘
               │
    ┌──────────▼──────────┐
    │   pre-context.ts    │ ← 操作前查現狀
    │   名稱驗證 + 攔截    │ ← error-learner 歷史警告
    └──────────┬──────────┘
               │
    ┌──────────▼──────────┐
    │   adapter.execute   │ ← 實際 API 呼叫
    └──────────┬──────────┘
               │
    ┌──────────▼──────────┐
    │   logger.ts         │ ← 記錄到 operations 表
    │   post-check.ts     │ ← 異常偵測
    │   action-chain.ts   │ ← 下一步建議
    │   pattern-analyzer  │ ← 行為模式學習
    │   sop-detector      │ ← 重複流程偵測
    └──────────┬──────────┘
               │
    ┌──────────▼──────────┐
    │   認知進化引擎       │ ← 你在這裡
    │   分析失敗 → 優化    │
    │   程式碼 + CLAUDE.md │
    └──────────┬──────────┘
               │
               ▼
    AI 下次使用時自動受益
```

---

## 反模式

1. **不要只改 CLAUDE.md 不改程式碼** — 如果問題能自動修正，改程式碼效果 > 寫規則
2. **不要在 adapter 裡做通用轉換** — 通用邏輯放 param-guard，adapter 只做 App-specific 的事
3. **不要寫模糊原則** — 「注意品質」不是認知，「adapter 必須實作 formatResponse」才是
4. **不要只記錄問題不記錄解法** — 「壞了要這樣修」比「曾經壞過」有用
5. **不要忘記刪除過時的認知** — 改了架構就要更新 CLAUDE.md 對應的描述

---

## 目前系統的已知缺口（待補強）

供未來迭代參考，這些是迴路中尚未閉合的環節：

| 缺口 | 說明 | 影響 |
|------|------|------|
| 迴路未閉合 | pattern-analyzer 偵測到的模式沒有自動回饋到 param-guard | 學到了但沒用上 |
| 無結果品質追蹤 | success 只有 true/false，沒有「成功但不滿意」 | 無法優化「能用但不好用」的 case |
| 閾值硬編碼 | MIN_OPS_FOR_PATTERN=3、ANOMALY_MULTIPLIER=3 都寫死 | 無法適應不同使用量的用戶 |
| 單步預測 | action-chain 只用一階 Markov chain | 看不見多步驟工作流 |
| 錯誤類型未區分 | error-learner 把所有非暫態錯誤一視同仁 | 無法針對性修正 |

---
相關 Skill：
- 如果需要建新 skill → `skill-builder.md`
- 提交前 → `commit.md`
