/**
 * 組合技 Registry
 * 每個組合技的 prerequisites 必須引用實際存在的 adapter + action
 * 啟動時自動驗證，不合法的組合技不註冊
 */

import { loadAdapters, getAllAdapters } from "@/mcp/registry";

/* ── 類型定義 ── */

/** 組合技前置條件：指定 App 的指定 action */
export interface ComboPrerequisite {
  app: string;
  action: string;
}

/** 組合技定義 */
export interface ComboDefinition {
  id: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  prerequisites: ComboPrerequisite[];
}

/** 組合技 API 回傳（帶即時計算的 unlocked 狀態） */
export interface ComboResult extends ComboDefinition {
  unlocked: boolean;
}

/* ── 組合技定義清單 ── */
/* T 組修正：技能樹從空長出來，不預設任何跨 App 組合技。
 * 組合技由 workflow-detector 從 operations pattern 自動偵測產生（只限同 App 內）。
 * 跨 App 流程只有使用者透過 AI 定義的 workflow 才會出現。
 * 預設的跨 App 組合技全部刪除 — 沒有使用者行為依據的自動執行會添亂。
 */
const COMBO_DEFINITIONS: ComboDefinition[] = [
  // 空：組合技由後端自動偵測產生，前端只負責渲染
];

/* ── 驗證與載入 ── */

/** 已驗證的組合技（啟動時填充） */
let validatedCombos: ComboDefinition[] = [];

/**
 * 載入並驗證所有組合技
 * 逐條檢查 prerequisites 裡的 {app, action} 是否存在於 adapter 的 actionMap
 * 不合法的組合技跳過不註冊
 */
export async function loadCombos(): Promise<void> {
  await loadAdapters();
  const adapters = getAllAdapters();

  /* 建立 app → actionMap keys 的快速查詢表 */
  const actionIndex = new Map<string, Set<string>>();
  for (const adapter of adapters) {
    actionIndex.set(adapter.name, new Set(Object.keys(adapter.actionMap)));
  }

  /* 驗證每個組合技 */
  const valid: ComboDefinition[] = [];
  for (const combo of COMBO_DEFINITIONS) {
    let allValid = true;
    for (const prereq of combo.prerequisites) {
      const actions = actionIndex.get(prereq.app);
      if (!actions || !actions.has(prereq.action)) {
        console.warn(
          `[Combo Registry] 跳過 "${combo.id}"：找不到 ${prereq.app}.${prereq.action}`,
        );
        allValid = false;
        break;
      }
    }
    if (allValid) {
      valid.push(combo);
    }
  }

  validatedCombos = valid;
  console.log(
    `[Combo Registry] 載入 ${valid.length}/${COMBO_DEFINITIONS.length} 個組合技`,
  );
}

/**
 * 取得所有已驗證的組合技，並根據用戶已連接的 App 計算 unlocked 狀態
 * @param connectedAppNames 用戶已連接的 App 名稱 Set
 */
export function getCombosWithStatus(connectedAppNames: Set<string>): ComboResult[] {
  return validatedCombos.map((combo) => {
    /* 所有前置條件的 App 都已連接 → unlocked */
    const requiredApps = new Set(combo.prerequisites.map((p) => p.app));
    const unlocked = [...requiredApps].every((app) => connectedAppNames.has(app));
    return { ...combo, unlocked };
  });
}
