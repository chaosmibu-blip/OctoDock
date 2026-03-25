import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * 資料完整性健康檢查
 * GET /api/health/data?key=ADMIN_KEY
 * 回傳每個表的欄位填充率，低於閾值的標記異常
 * 需要 HEALTH_CHECK_KEY 環境變數作為認證（不公開）
 */

// 預期填充率閾值
const THRESHOLDS: Record<string, Record<string, number>> = {
  operations: {
    intent: 0.8,
  },
  connected_apps: {
    app_user_id: 0.7,
    app_user_name: 0.7,
  },
};

export async function GET(request: NextRequest) {
  // 認證：比對 URL 參數的 key
  const key = request.nextUrl.searchParams.get("key");
  const expectedKey = process.env.HEALTH_CHECK_KEY;
  if (!expectedKey || key !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 查所有表的行數
    const tables = await db.execute(sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);

    const report: Record<string, {
      rowCount: number;
      fields?: Record<string, { filled: number; total: number; rate: string; ok: boolean }>;
    }> = {};

    for (const row of tables.rows) {
      const tableName = row.tablename as string;
      if (tableName === "_migrations") continue;

      const countResult = await db.execute(sql.raw(`SELECT COUNT(*) as total FROM "${tableName}"`));
      const total = parseInt(countResult.rows[0]?.total as string ?? "0");
      report[tableName] = { rowCount: total };

      // 如果有閾值定義，檢查欄位填充率
      const tableThresholds = THRESHOLDS[tableName];
      if (tableThresholds && total > 0) {
        report[tableName].fields = {};
        for (const [field, threshold] of Object.entries(tableThresholds)) {
          const fillResult = await db.execute(
            sql.raw(`SELECT COUNT("${field}") as filled FROM "${tableName}" WHERE "${field}" IS NOT NULL`),
          );
          const filled = parseInt(fillResult.rows[0]?.filled as string ?? "0");
          const rate = filled / total;
          report[tableName].fields![field] = {
            filled,
            total,
            rate: `${(rate * 100).toFixed(1)}%`,
            ok: rate >= threshold,
          };
        }
      }
    }

    // 最後一次操作時間
    const lastOp = await db.execute(sql`
      SELECT created_at FROM operations ORDER BY created_at DESC LIMIT 1
    `);
    const lastOperationAt = lastOp.rows[0]?.created_at ?? null;

    // 總結
    const allChecks = Object.values(report)
      .flatMap((t) => Object.values(t.fields ?? {}));
    const failCount = allChecks.filter((c) => !c.ok).length;

    return NextResponse.json({
      status: failCount === 0 ? "healthy" : "issues_found",
      issueCount: failCount,
      lastOperationAt,
      checkedAt: new Date().toISOString(),
      tables: report,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Health check failed", detail: String(error) },
      { status: 500 },
    );
  }
}
