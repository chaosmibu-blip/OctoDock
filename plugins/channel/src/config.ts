// ============================================================
// Plugin 設定管理
// API key 存在用戶家目錄的 .octodock/config.json
// 透過 /octodock:configure 指令設定
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/** Plugin 設定 */
export interface PluginConfig {
  /** OctoDock API key（ak_xxx），用於 SSE 事件連線認證 */
  apiKey: string | null;
  /** OctoDock 雲端 URL（預設 https://octo-dock.com） */
  serverUrl: string;
}

/** 設定檔路徑 */
const CONFIG_DIR = join(homedir(), ".octodock");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/** 預設設定 */
const DEFAULT_CONFIG: PluginConfig = {
  apiKey: null,
  serverUrl: "https://octo-dock.com",
};

/**
 * 載入設定
 * 從 ~/.octodock/config.json 讀取，不存在則回傳預設值
 */
export function loadConfig(): PluginConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const raw = readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
      };
    }
  } catch (err) {
    console.error("[octodock] Failed to load config:", err);
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * 儲存設定
 * 寫入 ~/.octodock/config.json
 */
export function saveConfig(config: Partial<PluginConfig>): void {
  const current = loadConfig();
  const merged = { ...current, ...config };

  // 確保目錄存在
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
  console.error(`[octodock] Config saved to ${CONFIG_FILE}`);
}
