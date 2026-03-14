import { readdirSync } from "fs";
import { join } from "path";
import { type AppAdapter, isAppAdapter } from "@/adapters/types";

// ============================================================
// Adapter Registry（自動掃描註冊器）
// 啟動時自動掃描 src/adapters/ 資料夾，載入所有 App Adapter
// 加一個新 App = 在 adapters/ 加一個檔案，核心系統不用改
// ============================================================

/** 已載入的 Adapter 存放處，key 為 App 名稱 */
const adapters = new Map<string, AppAdapter>();

/**
 * 掃描 src/adapters/ 資料夾，載入所有 Adapter
 * 跳過 types.ts（那是型別定義，不是 Adapter）
 * 每個 .ts 檔案裡找有沒有 export 符合 AppAdapter 介面的物件
 */
export async function loadAdapters(): Promise<void> {
  const adapterDir = join(process.cwd(), "src", "adapters");
  const files = readdirSync(adapterDir).filter(
    (f) => f !== "types.ts" && f.endsWith(".ts"),
  );

  for (const file of files) {
    try {
      // 動態 import adapter 模組
      const mod = await import(`@/adapters/${file.replace(".ts", "")}`);
      // 在模組的所有 export 中找到 AppAdapter
      const adapter = Object.values(mod).find(isAppAdapter);
      if (adapter) {
        adapters.set(adapter.name, adapter);
      }
    } catch (error) {
      // 錯誤隔離：一個 Adapter 載入失敗不影響其他
      console.error(`Failed to load adapter ${file}:`, error);
    }
  }

  console.log(
    `Loaded ${adapters.size} adapters: ${[...adapters.keys()].join(", ")}`,
  );
}

/** 根據 App 名稱取得 Adapter */
export function getAdapter(appName: string): AppAdapter | undefined {
  return adapters.get(appName);
}

/** 取得所有已載入的 Adapter（用於 agentdock_help 列出可用 App） */
export function getAllAdapters(): AppAdapter[] {
  return [...adapters.values()];
}
