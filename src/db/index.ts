import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import fs from "fs";
import path from "path";

// 如果連線字串包含 sslmode=require，加上 uselibpqcompat=true 消除 pg 的 SSL warning
const dbUrl = process.env.DATABASE_URL ?? "";
const connectionString = dbUrl.includes("sslmode=require") && !dbUrl.includes("uselibpqcompat")
  ? dbUrl + "&uselibpqcompat=true"
  : dbUrl;

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

/**
 * 啟動時自動執行 pending SQL migrations
 * 使用 _migrations 表追蹤已執行的 migration，確保每個檔案只執行一次
 * 失敗不阻塞啟動，只輸出警告
 */
async function runPendingMigrations() {
  const client = await pool.connect();
  try {
    // 建立 migration 追蹤表（如果不存在）
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 讀取 migrations 資料夾（Next.js 打包後 __dirname 可能不正確，改用 process.cwd()）
    const migrationsDir = path.join(process.cwd(), "src", "db", "migrations");
    if (!fs.existsSync(migrationsDir)) return;

    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort(); // 按檔名排序確保執行順序

    // 查詢已執行的 migration
    const { rows } = await client.query("SELECT name FROM _migrations");
    const executed = new Set(rows.map((r) => r.name));

    // 逐一執行 pending migrations
    for (const file of files) {
      if (executed.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        console.log(`[db] Migration executed: ${file}`);
      } catch (err) {
        console.warn(`[db] Migration failed (${file}):`, err);
      }
    }
  } catch (err) {
    console.warn("[db] Auto-migration skipped:", err);
  } finally {
    client.release();
  }
}

// 啟動時非同步執行 migrations（不阻塞 import）
runPendingMigrations().catch(() => {});
