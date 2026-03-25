/**
 * 資料完整性檢查（動態）
 * 連到 DB 查每個表的欄位填充率，低於預期閾值就報警
 *
 * 用法：
 *   npx tsx scripts/check-data-integrity.ts                    # 用 DATABASE_URL
 *   DATABASE_URL="postgres://..." npx tsx scripts/check-data-integrity.ts  # 指定 DB
 */

import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL 環境變數未設定");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// ── 預期閾值定義 ──
// 每個欄位應該有多少比例的記錄有值
// 沒列出的欄位不檢查（nullable 且不重要的）
const EXPECTED_FILL_RATES: Record<string, Record<string, number>> = {
  operations: {
    user_id: 1.0,
    app_name: 1.0,
    tool_name: 1.0,
    action: 1.0,
    params: 1.0,
    result: 1.0,
    success: 1.0,
    duration_ms: 0.95,
    intent: 0.8,       // octodock_do 應該都有，help 也改成有了
  },
  connected_apps: {
    user_id: 1.0,
    app_name: 1.0,
    access_token: 1.0,
    status: 1.0,
    app_user_id: 0.7,   // OAuth App 應該有，bot_token/api_key 可能沒有
    app_user_name: 0.7,
  },
  memory: {
    user_id: 1.0,
    category: 1.0,
    key: 1.0,
    value: 1.0,
    confidence: 1.0,
    source_count: 1.0,
    // embedding: 0.8,  // 擱置：等決定是否啟用語意搜尋
  },
  users: {
    email: 1.0,
    mcp_api_key: 1.0,
  },
};

interface CheckResult {
  table: string;
  field: string;
  total: number;
  filled: number;
  fillRate: number;
  expected: number;
  pass: boolean;
}

async function main() {
  const results: CheckResult[] = [];

  for (const [table, fields] of Object.entries(EXPECTED_FILL_RATES)) {
    // 取得表的總行數
    const countResult = await pool.query(`SELECT COUNT(*) as total FROM "${table}"`);
    const total = parseInt(countResult.rows[0].total);

    if (total === 0) {
      console.log(`  ${table}: 空表，跳過`);
      continue;
    }

    for (const [field, expected] of Object.entries(fields)) {
      // 查這個欄位有多少非 null 的記錄
      const fillResult = await pool.query(
        `SELECT COUNT("${field}") as filled FROM "${table}" WHERE "${field}" IS NOT NULL`,
      );
      const filled = parseInt(fillResult.rows[0].filled);
      const fillRate = filled / total;
      const pass = fillRate >= expected;

      results.push({ table, field, total, filled, fillRate, expected, pass });
    }
  }

  // ── 輸出報告 ──
  console.log("=== 資料完整性檢查 ===\n");

  const failures = results.filter((r) => !r.pass);
  const passes = results.filter((r) => r.pass);

  // 按表分組輸出
  const tables = [...new Set(results.map((r) => r.table))];
  for (const table of tables) {
    const tableResults = results.filter((r) => r.table === table);
    const tableTotal = tableResults[0]?.total ?? 0;
    console.log(`${table} (${tableTotal} 筆):`);
    for (const r of tableResults) {
      const pct = (r.fillRate * 100).toFixed(1);
      const expectedPct = (r.expected * 100).toFixed(0);
      const status = r.pass ? "✓" : "✗";
      console.log(
        `  ${status} ${r.field.padEnd(20)} ${r.filled}/${r.total} (${pct}%)  期望 ≥${expectedPct}%`,
      );
    }
    console.log("");
  }

  // 總結
  if (failures.length === 0) {
    console.log(`✅ 全部通過（${passes.length} 項檢查）`);
  } else {
    console.log(`❌ ${failures.length} 項未通過：`);
    for (const f of failures) {
      const pct = (f.fillRate * 100).toFixed(1);
      const expectedPct = (f.expected * 100).toFixed(0);
      console.log(`  ${f.table}.${f.field}: ${pct}% (期望 ≥${expectedPct}%)`);
    }
    process.exit(1);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("檢查失敗:", err);
  process.exit(1);
});
