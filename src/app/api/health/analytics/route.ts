import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * AI 操作模式分析
 * GET /api/health/analytics?key=ADMIN_KEY
 * 分析 AI 使用 OctoDock 的行為模式，找出可優化的操作
 */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  const expectedKey = process.env.HEALTH_CHECK_KEY;
  if (!expectedKey || key !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. 各 App 使用量 + 成功率 + 平均耗時
    const appUsage = await db.execute(sql`
      SELECT app_name,
        COUNT(*) as total,
        SUM(CASE WHEN success THEN 1 ELSE 0 END) as ok,
        ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 1) as success_rate,
        ROUND(AVG(duration_ms)::numeric, 0) as avg_ms
      FROM operations
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY app_name
      ORDER BY total DESC
    `);

    // 2. Top 20 最常用的 action
    const topActions = await db.execute(sql`
      SELECT app_name, action, COUNT(*) as cnt,
        ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 1) as success_rate,
        ROUND(AVG(duration_ms)::numeric, 0) as avg_ms
      FROM operations
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY app_name, action
      ORDER BY cnt DESC
      LIMIT 20
    `);

    // 3. 跨 App 轉換（A.action → B.action 的模式，5 分鐘內）
    const crossApp = await db.execute(sql`
      WITH ordered AS (
        SELECT app_name, action, created_at,
          LEAD(app_name) OVER (ORDER BY created_at) as next_app,
          LEAD(action) OVER (ORDER BY created_at) as next_action,
          LEAD(created_at) OVER (ORDER BY created_at) as next_time
        FROM operations
        WHERE success = true AND created_at >= NOW() - INTERVAL '30 days'
      )
      SELECT app_name || '.' || action as from_action,
        next_app || '.' || next_action as to_action,
        COUNT(*) as transitions
      FROM ordered
      WHERE next_app IS NOT NULL
        AND app_name != next_app
        AND next_time - created_at <= interval '5 minutes'
      GROUP BY from_action, to_action
      ORDER BY transitions DESC
      LIMIT 15
    `);

    // 4. 失敗最多的操作
    const failures = await db.execute(sql`
      SELECT app_name, action, COUNT(*) as fails
      FROM operations
      WHERE success = false AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY app_name, action
      HAVING COUNT(*) >= 2
      ORDER BY fails DESC
      LIMIT 10
    `);

    // 5. 重複操作（同一個 action 連續 3+ 次 — 可能可以用 batch_do 優化）
    const repeats = await db.execute(sql`
      WITH numbered AS (
        SELECT app_name, action, created_at,
          LAG(action) OVER (ORDER BY created_at) as prev_action,
          LAG(app_name) OVER (ORDER BY created_at) as prev_app
        FROM operations
        WHERE success = true AND created_at >= NOW() - INTERVAL '30 days'
      )
      SELECT app_name, action, COUNT(*) as consecutive_repeats
      FROM numbered
      WHERE action = prev_action AND app_name = prev_app
      GROUP BY app_name, action
      HAVING COUNT(*) >= 3
      ORDER BY consecutive_repeats DESC
    `);

    // 6. 最慢的操作
    const slowest = await db.execute(sql`
      SELECT app_name, action, COUNT(*) as cnt,
        ROUND(AVG(duration_ms)::numeric, 0) as avg_ms,
        MAX(duration_ms) as max_ms
      FROM operations
      WHERE duration_ms IS NOT NULL AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY app_name, action
      HAVING COUNT(*) >= 3
      ORDER BY avg_ms DESC
      LIMIT 10
    `);

    // 7. 讀後寫模式（get → replace/create/update/insert，可能可以用 transfer 優化）
    const readThenWrite = await db.execute(sql`
      WITH ordered AS (
        SELECT app_name, action, created_at,
          LEAD(app_name) OVER (ORDER BY created_at) as next_app,
          LEAD(action) OVER (ORDER BY created_at) as next_action,
          LEAD(created_at) OVER (ORDER BY created_at) as next_time
        FROM operations
        WHERE success = true AND created_at >= NOW() - INTERVAL '30 days'
      )
      SELECT app_name || '.' || action as read_action,
        next_app || '.' || next_action as write_action,
        COUNT(*) as occurrences
      FROM ordered
      WHERE action IN ('get_page', 'get', 'read', 'download', 'get_file', 'get_task', 'search')
        AND next_action IN ('replace_content', 'create_page', 'insert_text', 'append_text', 'create_file', 'update_file', 'send', 'create', 'create_task', 'append_content')
        AND next_time - created_at <= interval '10 minutes'
      GROUP BY read_action, write_action
      ORDER BY occurrences DESC
      LIMIT 10
    `);

    return NextResponse.json({
      period: "last 30 days",
      analyzedAt: new Date().toISOString(),
      appUsage: appUsage.rows,
      topActions: topActions.rows,
      crossAppTransitions: crossApp.rows,
      topFailures: failures.rows,
      repeatedActions: repeats.rows,
      slowestActions: slowest.rows,
      readThenWritePatterns: readThenWrite.rows,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Analytics failed", detail: String(error) },
      { status: 500 },
    );
  }
}
