#!/usr/bin/env npx tsx
// ============================================================
// 前後端同步驗證腳本
// 比對 adapters、dashboard APP_KEYS、i18n、registry、oauth-env
// 有差異就噴錯誤 + 具體告訴你缺什麼
// 用法：npx tsx scripts/check-sync.ts
// ============================================================

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
let errors: string[] = [];
let warnings: string[] = [];

// ── 工具函式 ──

/** 讀取檔案內容 */
function readFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf-8");
}

/** 記錄錯誤 */
function error(msg: string) {
  errors.push(msg);
}

/** 記錄警告 */
function warn(msg: string) {
  warnings.push(msg);
}

// ============================================================
// 1. 掃描 src/adapters/ 取得所有 adapter 名稱
// ============================================================

const SKIP_FILES = ["types.ts", "index.ts"];
const adapterDir = join(ROOT, "src", "adapters");
const adapterFiles = readdirSync(adapterDir)
  .filter((f) => f.endsWith(".ts") && !SKIP_FILES.includes(f));

/** adapter 檔名 → adapter name（把 - 轉 _，例如 google-calendar → google_calendar） */
function fileToAdapterName(filename: string): string {
  return filename.replace(".ts", "").replace(/-/g, "_");
}

/** 所有 adapter 名稱（排除 helper 檔案如 github-patch-file） */
const adapterFileMap = new Map<string, string>(); // name → filename
for (const file of adapterFiles) {
  const name = fileToAdapterName(file);
  adapterFileMap.set(name, file);
}

// 讀取各 adapter 的 actionMap 來取得所有 tool name
const adapterToolNames = new Map<string, string[]>(); // adapter name → tool names
for (const [name, file] of adapterFileMap) {
  const content = readFile(`src/adapters/${file}`);

  // 解析 actionMap 的值（tool name）
  // 匹配模式：key: "tool_name" 或 key: 'tool_name'
  const actionMapMatch = content.match(/actionMap[\s\S]*?=[\s\S]*?\{([\s\S]*?)\};/);
  if (actionMapMatch) {
    const mapBody = actionMapMatch[1];
    const toolNames = [...mapBody.matchAll(/:\s*["']([^"']+)["']/g)].map((m) => m[1]);
    adapterToolNames.set(name, toolNames);
  }

  // 也檢查是否 export 了 AppAdapter
  if (!content.includes("AppAdapter")) {
    // helper 檔案（如 github-patch-file）可能不是完整 adapter
    if (!content.includes("export")) continue;
    warn(`${file} 沒有實作 AppAdapter 介面，可能是 helper 檔案`);
  }
}

// 過濾掉 helper 檔案（沒有 actionMap 的不算 adapter）
const realAdapterNames = [...adapterToolNames.keys()];

console.log(`\n📦 找到 ${realAdapterNames.length} 個 adapter: ${realAdapterNames.join(", ")}\n`);

// ============================================================
// 2. 檢查 Dashboard APP_KEYS
// ============================================================

console.log("── 檢查 Dashboard APP_KEYS ──");

const dashboardContent = readFile("src/app/dashboard/dashboard-client.tsx");
const appKeysMatch = dashboardContent.match(/const APP_KEYS\s*=\s*\[([\s\S]*?)\];/);
const dashboardAppNames: string[] = [];

if (appKeysMatch) {
  const appKeysBody = appKeysMatch[1];
  // 匹配 name: "xxx"
  const names = [...appKeysBody.matchAll(/name:\s*["']([^"']+)["']/g)];
  for (const m of names) {
    dashboardAppNames.push(m[1]);
  }
}

// adapter 有但 APP_KEYS 沒有
for (const name of realAdapterNames) {
  if (!dashboardAppNames.includes(name)) {
    error(`APP_KEYS 缺少 adapter "${name}"（後端有但前端沒有）`);
  }
}

// APP_KEYS 有但 adapter 沒有
for (const name of dashboardAppNames) {
  if (!realAdapterNames.includes(name)) {
    error(`APP_KEYS 有 "${name}" 但找不到對應的 adapter 檔案`);
  }
}

if (errors.length === 0) console.log("  ✓ APP_KEYS 與 adapters 完全一致");

// ============================================================
// 3. 檢查 i18n 翻譯
// ============================================================

console.log("── 檢查 i18n 翻譯 ──");

const i18nContent = readFile("src/lib/i18n.tsx");

/** 從 i18n 內容中提取某個 locale 區塊的所有 key */
function extractI18nKeys(content: string, locale: string): Set<string> {
  // 找到 "zh-TW": { ... } 或 en: { ... } 區塊
  const localePattern = locale === "zh-TW"
    ? /"zh-TW"\s*:\s*\{/
    : /\ben\s*:\s*\{/;

  const startMatch = content.match(localePattern);
  if (!startMatch || startMatch.index === undefined) return new Set();

  // 從 locale 開始位置找配對的 }
  let depth = 0;
  let started = false;
  let blockStart = startMatch.index;
  let blockEnd = blockStart;

  for (let i = blockStart; i < content.length; i++) {
    if (content[i] === "{") {
      depth++;
      started = true;
    }
    if (content[i] === "}") {
      depth--;
      if (started && depth === 0) {
        blockEnd = i;
        break;
      }
    }
  }

  const block = content.slice(blockStart, blockEnd + 1);
  const keys = new Set<string>();
  // 匹配 "key.name":
  for (const m of block.matchAll(/"([^"]+)"\s*:/g)) {
    keys.add(m[1]);
  }
  return keys;
}

const zhKeys = extractI18nKeys(i18nContent, "zh-TW");
const enKeys = extractI18nKeys(i18nContent, "en");

// 3a. 檢查 app.{name}.desc
const errCountBefore = errors.length;
for (const name of realAdapterNames) {
  const key = `app.${name}.desc`;
  if (!zhKeys.has(key)) error(`i18n 缺少 zh-TW: "${key}"`);
  if (!enKeys.has(key)) error(`i18n 缺少 en: "${key}"`);
}

// 3b. 檢查 tool.{name} 翻譯
for (const [adapterName, toolNames] of adapterToolNames) {
  for (const toolName of toolNames) {
    const key = `tool.${toolName}`;
    if (!zhKeys.has(key)) warn(`i18n 缺少 zh-TW: "${key}"（${adapterName} adapter）`);
    if (!enKeys.has(key)) warn(`i18n 缺少 en: "${key}"（${adapterName} adapter）`);
  }
}

// 3c. 中英文 key 一致性
// 排除 locale 名稱本身（"zh-TW"、"en" 是 key 名不是翻譯 key）
const ignoredKeys = new Set(["zh-TW", "en"]);
const zhOnly = [...zhKeys].filter((k) => !enKeys.has(k) && !ignoredKeys.has(k));
const enOnly = [...enKeys].filter((k) => !zhKeys.has(k) && !ignoredKeys.has(k));

for (const key of zhOnly) {
  error(`i18n key "${key}" 只有 zh-TW，缺 en`);
}
for (const key of enOnly) {
  error(`i18n key "${key}" 只有 en，缺 zh-TW`);
}

if (errors.length === errCountBefore) console.log("  ✓ app.*.desc 翻譯完整");

// ============================================================
// 4. 檢查 registry.ts import 清單
// ============================================================

console.log("── 檢查 registry.ts import 清單 ──");

const registryContent = readFile("src/mcp/registry.ts");

// 提取 importAllAdapters 中的 import 路徑
const registryImports: string[] = [];
const importMatches = registryContent.matchAll(/import\("@\/adapters\/([^"]+)"\)/g);
for (const m of importMatches) {
  // 檔名用 - 格式，轉成 _ 格式比對
  registryImports.push(m[1].replace(/-/g, "_"));
}

const errCountBefore2 = errors.length;
for (const name of realAdapterNames) {
  if (!registryImports.includes(name)) {
    error(`registry.ts 缺少 import adapter "${name}"（production build 會載不到）`);
  }
}
for (const name of registryImports) {
  if (!realAdapterNames.includes(name)) {
    warn(`registry.ts import 了 "${name}" 但找不到對應的 adapter`);
  }
}

if (errors.length === errCountBefore2) console.log("  ✓ registry.ts import 清單完整");

// ============================================================
// 5. 檢查 oauth-env.ts 映射
// ============================================================

console.log("── 檢查 oauth-env.ts 映射 ──");

const oauthEnvContent = readFile("src/lib/oauth-env.ts");

// 提取 ENV_PREFIX_MAP 中的 app name
const envPrefixNames: string[] = [];
const envMapMatch = oauthEnvContent.match(/ENV_PREFIX_MAP[\s\S]*?=[\s\S]*?\{([\s\S]*?)\}/);
if (envMapMatch) {
  for (const m of envMapMatch[1].matchAll(/["']?(\w+)["']?\s*:/g)) {
    envPrefixNames.push(m[1]);
  }
}

// 檢查 OAuth adapter 有沒有在 oauth-env.ts 裡
const errCountBefore3 = errors.length;
for (const name of realAdapterNames) {
  const adapterContent = readFile(`src/adapters/${adapterFileMap.get(name)}`);
  // 只檢查 oauth2 類型的 adapter
  if (adapterContent.includes('authType: "oauth2"') || adapterContent.includes("authType: 'oauth2'")) {
    // Google 系列共用 GOOGLE，不一定每個都在 map 裡
    // Notion 用 fallback（APP_NAME.toUpperCase()），也不一定在 map 裡
    // 但至少要確認 env var 存在於 .env.example
    if (!envPrefixNames.includes(name)) {
      // 用 fallback 邏輯：APP_NAME.toUpperCase()_CLIENT_ID
      const upperName = name.toUpperCase();
      const envExample = readFile(".env.example");
      const hasClientId = envExample.includes(`${upperName}_CLIENT_ID`) ||
                          envExample.includes(`${upperName}_OAUTH_CLIENT_ID`);
      if (!hasClientId) {
        warn(`OAuth adapter "${name}" 不在 ENV_PREFIX_MAP 且 .env.example 缺少 ${upperName}_CLIENT_ID`);
      }
    }
  }
}

if (errors.length === errCountBefore3) console.log("  ✓ OAuth 映射檢查通過");

// ============================================================
// 6. 檢查 error-hints.ts per-app hints（警告級）
// ============================================================

console.log("── 檢查 error-hints.ts ──");

const errorHintsContent = readFile("src/mcp/error-hints.ts");
const hintAppNames: string[] = [];
// 找 APP_HINTS 或 per-app 區塊中的 app name
const appHintsMatch = errorHintsContent.match(/APP_HINTS[\s\S]*?=[\s\S]*?\{([\s\S]*?)\n\};/);
if (appHintsMatch) {
  // 只抓第一層的 key（縮排 2 格的才是 app name，更深的是巢狀屬性）
  for (const m of appHintsMatch[1].matchAll(/^\s{2}(\w+)\s*:/gm)) {
    const name = m[1];
    // 排除非 app name 的 key（如 explanation、suggestion）
    if (!["explanation", "suggestion", "pattern", "code", "app"].includes(name)) {
      hintAppNames.push(name);
    }
  }
}

for (const name of hintAppNames) {
  if (!realAdapterNames.includes(name)) {
    warn(`error-hints.ts 有 "${name}" 的 hints 但找不到對應的 adapter`);
  }
}
console.log(`  ℹ ${hintAppNames.length} 個 app 有自訂 error hints`);

// ============================================================
// 結果輸出
// ============================================================

console.log("\n════════════════════════════════════");

if (warnings.length > 0) {
  console.log(`\n⚠️  ${warnings.length} 個警告：`);
  for (const w of warnings) {
    console.log(`  ⚠ ${w}`);
  }
}

if (errors.length > 0) {
  console.log(`\n❌ ${errors.length} 個錯誤：`);
  for (const e of errors) {
    console.log(`  ✗ ${e}`);
  }
  console.log("\n前後端不同步！請修復以上問題。\n");
  process.exit(1);
} else {
  console.log(`\n✅ 前後端同步檢查通過（${realAdapterNames.length} 個 adapter）`);
  if (warnings.length > 0) {
    console.log(`   （${warnings.length} 個警告可後續處理）`);
  }
  console.log("");
  process.exit(0);
}
