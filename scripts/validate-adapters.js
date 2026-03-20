/**
 * Build-time 驗證：檢查每個 adapter 的 getSkill() 總覽是否涵蓋 actionMap 的所有 action
 * 在 `npm run build` 前執行，有遺漏就中斷 build
 *
 * 用途：開發者加了新 action 到 actionMap，但忘了更新 getSkill 總覽
 *      → AI 呼叫 octodock_help(app) 時看不到該功能
 *      → 這個腳本在 build 時就擋住，不讓問題上線
 */

const fs = require("fs");
const path = require("path");

const ADAPTER_DIR = path.join(__dirname, "..", "src", "adapters");
const SKIP_FILES = ["types.ts", "github-patch-file.ts"];

/** 從 adapter 原始碼提取 actionMap 的所有 key */
function extractActionMapKeys(content) {
  const match = content.match(
    /(?:const\s+actionMap|actionMap)\s*[:=]\s*(?:Record<[^>]+>\s*=\s*)?\{([\s\S]*?)\n\};/,
  );
  if (!match) return [];

  const keys = [];
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    // 跳過純註解行和空行
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed === "")
      continue;
    const m = trimmed.match(/^(\w+)\s*:/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/** 從 adapter 原始碼提取 getSkill() 無參數時的總覽文字 */
function extractGetSkillOverview(content) {
  // 匹配 getSkill 函式中 return 的 template literal 總覽
  const match = content.match(
    /function\s+\w*[Gg]et[Ss]kill\b[\s\S]*?return\s+`([^`]+)`/,
  );
  return match ? match[1] : null;
}

// ── 主程式 ──

const files = fs
  .readdirSync(ADAPTER_DIR)
  .filter((f) => f.endsWith(".ts") && !SKIP_FILES.includes(f));

let hasError = false;

for (const file of files) {
  const content = fs.readFileSync(path.join(ADAPTER_DIR, file), "utf-8");
  const actionKeys = extractActionMapKeys(content);
  if (actionKeys.length === 0) continue;

  const overview = extractGetSkillOverview(content);
  if (!overview) continue;

  const missing = actionKeys.filter((key) => !overview.includes(key));
  if (missing.length > 0) {
    hasError = true;
    console.error(
      `\x1b[31m✗ ${file}\x1b[0m — getSkill() 漏列 ${missing.length} 個 action: ${missing.join(", ")}`,
    );
    console.error(
      `  → AI 呼叫 octodock_help("${file.replace(".ts", "")}") 時看不到這些功能`,
    );
  }
}

if (hasError) {
  console.error(
    "\n\x1b[31m❌ Build 中斷：有 adapter 的 getSkill() 沒有列出所有 actionMap 的 action\x1b[0m",
  );
  console.error("請更新對應 adapter 的 getSkill() 總覽文字，補上遺漏的 action\n");
  process.exit(1);
} else {
  console.log(
    `\x1b[32m✓ 所有 ${files.length} 個 adapter 的 getSkill ↔ actionMap 一致\x1b[0m`,
  );
}
