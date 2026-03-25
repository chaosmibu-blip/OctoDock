/**
 * Schema-Code 契約檢查（靜態）
 * 掃描 schema.ts 的所有表和欄位，確認每個需要手動寫入的欄位在程式碼裡有對應的寫入
 *
 * 用法：npx tsx scripts/check-schema-coverage.ts
 */

import { execSync } from "child_process";
import * as fs from "fs";

// ── 從 schema.ts 提取所有表和欄位 ──
const schemaContent = fs.readFileSync("src/db/schema.ts", "utf-8");

// 匹配 export const tableName = pgTable("table_name", { ... })
const tableRegex = /export const (\w+) = pgTable\("(\w+)",\s*\{([\s\S]*?)\}\)/g;

// 不需要手動寫入的欄位（有 default 值或自動產生的）
const AUTO_FIELDS = new Set([
  "id",           // gen_random_uuid()
  "createdAt",    // now()
  "created_at",
  "updatedAt",    // now()
  "updated_at",
]);

// 已知擱置的欄位（有明確原因暫時不寫入的）
const KNOWN_SKIPPED: Record<string, string> = {
  "memory.embedding": "擱置：等決定是否啟用語意搜尋（需要 OPENAI_EMBEDDING_API_KEY）",
  "users.email_verified": "由 NextAuth 管理，不在 OctoDock 程式碼中寫入",
  "oauth_clients.secret_hash": "OAuth provider 功能尚未上線",
  "oauth_clients.redirect_uris": "OAuth provider 功能尚未上線",
};

interface FieldCheck {
  table: string;
  tableName: string; // DB 中的表名
  field: string;
  columnName: string; // DB 中的欄位名
  hasWriter: boolean;
  grepResult: string;
}

const results: FieldCheck[] = [];
let match: RegExpExecArray | null;

while ((match = tableRegex.exec(schemaContent)) !== null) {
  const varName = match[1];     // TypeScript 變數名（如 connectedApps）
  const tableName = match[2];   // DB 表名（如 connected_apps）
  const body = match[3];

  // 提取欄位：fieldName: type("column_name")
  const fieldRegex = /(\w+):\s*\w+\("(\w+)"/g;
  let fieldMatch: RegExpExecArray | null;

  while ((fieldMatch = fieldRegex.exec(body)) !== null) {
    const fieldName = fieldMatch[1];   // TypeScript 欄位名
    const columnName = fieldMatch[2];  // DB 欄位名

    // 跳過自動欄位
    if (AUTO_FIELDS.has(fieldName) || AUTO_FIELDS.has(columnName)) continue;

    // 在程式碼中搜尋寫入（排除 schema.ts 本身和 migration 檔案）
    // 搜尋模式：varName.fieldName 或 column_name 出現在 insert/update 附近
    let hasWriter = false;
    let grepResult = "";

    try {
      // 搜尋 TypeScript 欄位名（用在 Drizzle ORM 的 insert/update）
      const grep1 = execSync(
        `grep -rn "${fieldName}" src/ --include="*.ts" | grep -v "schema.ts" | grep -v "migration" | grep -v ".d.ts" | head -5`,
        { encoding: "utf-8", timeout: 5000 },
      ).trim();

      if (grep1) {
        // 進一步確認是不是寫入操作（不只是讀取）
        const writePatterns = [
          `${fieldName}:`,      // insert values 裡的 { fieldName: value }
          `${fieldName} =`,     // 直接賦值
          `set.*${fieldName}`,  // onConflictDoUpdate 的 set
        ];
        for (const pattern of writePatterns) {
          try {
            const grep2 = execSync(
              `grep -rn "${pattern}" src/ --include="*.ts" | grep -v "schema.ts" | grep -v "migration" | grep -v ".d.ts" | head -3`,
              { encoding: "utf-8", timeout: 5000 },
            ).trim();
            if (grep2) {
              hasWriter = true;
              grepResult = grep2.split("\n")[0]; // 取第一筆
              break;
            }
          } catch {
            // grep 沒找到不是錯誤
          }
        }
      }
    } catch {
      // grep 執行失敗
    }

    results.push({
      table: varName,
      tableName,
      field: fieldName,
      columnName,
      hasWriter,
      grepResult,
    });
  }
}

// ── 輸出報告 ──
console.log("=== Schema-Code 契約檢查 ===\n");

const missing = results.filter((r) => !r.hasWriter);
const covered = results.filter((r) => r.hasWriter);

if (missing.length === 0) {
  console.log("✅ 所有欄位都有對應的寫入程式碼\n");
} else {
  console.log(`❌ 發現 ${missing.length} 個欄位沒有寫入程式碼：\n`);

  // 按表分組
  const byTable = new Map<string, typeof missing>();
  for (const m of missing) {
    const key = `${m.table} (${m.tableName})`;
    if (!byTable.has(key)) byTable.set(key, []);
    byTable.get(key)!.push(m);
  }

  for (const [table, fields] of byTable) {
    console.log(`  ${table}:`);
    for (const f of fields) {
      const knownKey = `${f.tableName}.${f.columnName}`;
      const skipNote = KNOWN_SKIPPED[knownKey];
      if (skipNote) {
        console.log(`    ⏸ ${f.field} (${f.columnName}) — ${skipNote}`);
      } else {
        console.log(`    ✗ ${f.field} (${f.columnName})`);
      }
    }
  }
}

console.log(`\n統計：${covered.length} 個欄位有寫入 / ${results.length} 個需檢查的欄位`);

// 如果有未知的缺失（不在 KNOWN_SKIPPED 裡），exit code 非 0
const unknownMissing = missing.filter(
  (m) => !KNOWN_SKIPPED[`${m.tableName}.${m.columnName}`],
);
if (unknownMissing.length > 0) {
  console.log(`\n⚠️ ${unknownMissing.length} 個欄位缺少寫入且無已知原因`);
  process.exit(1);
}
