import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { type AppAdapter, isAppAdapter } from "@/adapters/types";

// ============================================================
// Adapter Registry（自動掃描 + 明確註冊）
// 雙重機制確保所有 Adapter 都能被載入：
// 1. 自動掃描 src/adapters/ 資料夾
// 2. 明確 import 清單（fallback，確保 production build 能載入）
// ============================================================

/** 已載入的 Adapter 存放處，key 為 App 名稱 */
const adapters = new Map<string, AppAdapter>();

/**
 * 明確 import 所有 Adapter（確保 Next.js production build 能載入）
 * 新增 App 時在這裡加一行 import
 */
async function importAllAdapters(): Promise<void> {
  const modules = await Promise.allSettled([
    // Google 系列
    import("@/adapters/gmail"),
    import("@/adapters/google-calendar"),
    import("@/adapters/google-drive"),
    import("@/adapters/google-sheets"),
    import("@/adapters/google-tasks"),
    import("@/adapters/google-docs"),
    import("@/adapters/youtube"),
    // 筆記 / 文件
    import("@/adapters/notion"),
    // 開發
    import("@/adapters/github"),
    // 通訊 / 社群
    import("@/adapters/line"),
    import("@/adapters/telegram"),
    import("@/adapters/telegram-user"),
    import("@/adapters/discord"),
    import("@/adapters/slack"),
    import("@/adapters/threads"),
    import("@/adapters/instagram"),
    // Microsoft Office
    import("@/adapters/microsoft-excel"),
    import("@/adapters/microsoft-word"),
    import("@/adapters/microsoft-powerpoint"),
    // 設計
    import("@/adapters/canva"),
    // 簡報
    import("@/adapters/gamma"),
    // 任務管理
    import("@/adapters/todoist"),
  ]);

  for (const result of modules) {
    if (result.status === "fulfilled") {
      const mod = result.value;
      const adapter = Object.values(mod).find(isAppAdapter);
      if (adapter && !adapters.has(adapter.name)) {
        adapters.set(adapter.name, adapter);
      }
    } else {
      // 載入失敗不影響其他 Adapter（錯誤隔離）
      console.error("Failed to load adapter:", result.reason);
    }
  }
}

/**
 * 載入所有 Adapter
 * 先用明確 import（確保 production 能用），再嘗試自動掃描（捕捉新增的）
 */
export async function loadAdapters(): Promise<void> {
  // 1. 明確 import（production 保底）
  await importAllAdapters();

  // 2. 嘗試自動掃描（開發環境可以自動發現新增的 adapter）
  try {
    const adapterDir = join(process.cwd(), "src", "adapters");
    if (existsSync(adapterDir)) {
      const files = readdirSync(adapterDir).filter(
        (f) => f !== "types.ts" && f.endsWith(".ts"),
      );

      for (const file of files) {
        const name = file.replace(".ts", "");
        // 跳過已經透過明確 import 載入的
        try {
          const mod = await import(`@/adapters/${name}`);
          const adapter = Object.values(mod).find(isAppAdapter);
          if (adapter && !adapters.has(adapter.name)) {
            adapters.set(adapter.name, adapter);
          }
        } catch {
          // 動態 import 在 production 可能失敗，已有明確 import 保底
        }
      }
    }
  } catch {
    // 自動掃描失敗不影響主流程
  }

  console.log(
    `Loaded ${adapters.size} adapters: ${[...adapters.keys()].join(", ")}`,
  );

  // ── 驗證：getSkill 是否涵蓋所有 actionMap 的 action ──
  // 載入時就抓到 drift，避免 AI 看不到已實作的功能
  validateAdapterSkills();
}

/**
 * 驗證每個 adapter 的 getSkill() 總覽是否列出 actionMap 的所有 action
 * 有遺漏就印 warning，開發者加 action 後忘了更新 getSkill 會被抓到
 */
function validateAdapterSkills(): void {
  for (const [name, adapter] of adapters) {
    if (!adapter.actionMap || !adapter.getSkill) continue;
    const actionKeys = Object.keys(adapter.actionMap);
    // 取 getSkill 總覽（無參數呼叫）
    const overview = adapter.getSkill();
    if (!overview) continue;
    // 檢查每個 actionMap key 是否出現在總覽文字中
    const missing = actionKeys.filter((key) => !overview.includes(key));
    if (missing.length > 0) {
      console.warn(
        `⚠️ [${name}] getSkill() 漏列 ${missing.length} 個 action: ${missing.join(", ")}` +
        `\n   → AI 呼叫 octodock_help("${name}") 時看不到這些功能，請更新 getSkill`,
      );
    }
  }
}

/** 單例 Promise：確保 loadAdapters 只執行一次，並發請求共享同一個 Promise */
let loadPromise: Promise<void> | null = null;

/** 確保 Adapter 已載入（並發安全的單例模式） */
export function ensureAdapters(): Promise<void> {
  if (adapters.size > 0) return Promise.resolve();
  if (!loadPromise) loadPromise = loadAdapters();
  return loadPromise;
}

/** 根據 App 名稱取得 Adapter */
export function getAdapter(appName: string): AppAdapter | undefined {
  return adapters.get(appName);
}

/** 取得所有已載入的 Adapter（用於 octodock_help 列出可用 App） */
export function getAllAdapters(): AppAdapter[] {
  return [...adapters.values()];
}
