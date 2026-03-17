import { db } from "@/db";
import { memory } from "@/db/schema";
import { and, eq, ilike, or, desc, sql, inArray } from "drizzle-orm";
import { getEmbedding, toVectorString } from "./embedding";

// ============================================================
// 記憶引擎（Memory Engine）
// OctoDock 的核心元件之一：管理用戶的跨 agent 共享記憶
// 儲存用 DB（PostgreSQL + pgvector），呈現用 MD，寫入收自然語言
// ============================================================

/** 跳脫 LIKE/ILIKE 的萬用字元（%、_），防止 wildcard 注入 */
function escapeLike(input: string): string {
  return input.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** 記憶條目的結構 */
export interface MemoryEntry {
  key: string; // 記憶的識別鍵（例如 "folder:會議"）
  value: string; // 記憶的內容（例如 page_id）
  category: string; // 分類：preference / pattern / context / sop
  appName: string | null; // 關聯的 App（null 表示跨 App 記憶）
  confidence: number | null; // 信心分數（0-1，越高越可靠）
  lastUsedAt: Date | null; // 最近使用時間（用於排序和清理）
}

// ============================================================
// 記憶查詢
// 優先用語意搜尋（pgvector embedding），找不到才退回文字搜尋
// ============================================================

/**
 * 查詢用戶記憶
 * 1. 先嘗試語意搜尋（embedding 向量相似度）
 * 2. 如果語意搜尋沒結果，退回文字搜尋（ilike）
 */
export async function queryMemory(
  userId: string,
  query: string,
  category?: string,
  appName?: string,
  limit = 10,
): Promise<MemoryEntry[]> {
  // 有查詢文字時，優先嘗試語意搜尋
  if (query) {
    const embedding = await getEmbedding(query);
    if (embedding) {
      const results = await semanticQuery(
        userId,
        embedding,
        category,
        appName,
        limit,
      );
      if (results.length > 0) {
        updateLastUsed(userId, results);
        return results;
      }
    }
  }

  // 退回方案：文字比對搜尋
  return textQuery(userId, query, category, appName, limit);
}

/**
 * 語意搜尋：用 pgvector 的向量距離找最相似的記憶
 * 只回傳相似度 > 0.3 的結果，避免不相關的雜訊
 */
async function semanticQuery(
  userId: string,
  embedding: number[],
  category?: string,
  appName?: string,
  limit = 10,
): Promise<MemoryEntry[]> {
  const vectorStr = toVectorString(embedding);

  // 動態組合 WHERE 條件
  let where = sql`user_id = ${userId} AND embedding IS NOT NULL`;
  if (category) where = sql`${where} AND category = ${category}`;
  if (appName) where = sql`${where} AND app_name = ${appName}`;

  // 用餘弦距離排序，取最相似的前 N 筆
  const results = await db.execute(sql`
    SELECT key, value, category, app_name AS "appName",
           confidence, last_used_at AS "lastUsedAt",
           1 - (embedding <=> ${vectorStr}::vector) AS similarity
    FROM memory
    WHERE ${where}
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `);

  const rows = results.rows as unknown as Array<MemoryEntry & { similarity: number }>;
  // 過濾掉相似度太低的結果
  return rows.filter(
    (r) => r.similarity > 0.3,
  );
}

/**
 * 文字搜尋：用 ilike 在 key 和 value 欄位做模糊比對
 * 當語意搜尋沒結果時的退回方案
 */
async function textQuery(
  userId: string,
  query: string,
  category?: string,
  appName?: string,
  limit = 10,
): Promise<MemoryEntry[]> {
  const conditions = [eq(memory.userId, userId)];

  if (category) {
    conditions.push(eq(memory.category, category));
  }

  if (appName) {
    conditions.push(eq(memory.appName, appName));
  }

  // 在 key 和 value 兩個欄位都做模糊搜尋
  if (query) {
    conditions.push(
      or(
        ilike(memory.key, `%${escapeLike(query)}%`),
        ilike(memory.value, `%${escapeLike(query)}%`),
      )!,
    );
  }

  const results = await db
    .select({
      key: memory.key,
      value: memory.value,
      category: memory.category,
      appName: memory.appName,
      confidence: memory.confidence,
      lastUsedAt: memory.lastUsedAt,
    })
    .from(memory)
    .where(and(...conditions))
    .orderBy(desc(memory.confidence), desc(memory.updatedAt))
    .limit(limit);

  updateLastUsed(userId, results);
  return results;
}

/**
 * 更新記憶的最近使用時間（非同步，不阻塞主請求）
 * 讓常用的記憶排在前面，也用於判斷記憶是否過時
 */
function updateLastUsed(userId: string, results: MemoryEntry[]): void {
  if (results.length === 0) return;
  const keys = results.map((r) => r.key);
  db.update(memory)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(memory.userId, userId),
        inArray(memory.key, keys),
      ),
    )
    .catch((err) => console.error("Failed to update lastUsedAt:", err));
}

// ============================================================
// 記憶儲存
// 支援 upsert（新增或更新），自動產生 embedding
// ============================================================

/**
 * 儲存一筆記憶
 * 如果同一個 userId + category + key 已存在，會更新 value 並提高 confidence
 * 同時產生 embedding 供語意搜尋使用
 */
export async function storeMemory(
  userId: string,
  key: string,
  value: string,
  category: string,
  appName?: string,
): Promise<void> {
  // 產生 embedding 文字：結合 key 和 value
  const embeddingText = `${key}: ${value}`;
  const embedding = await getEmbedding(embeddingText);

  // Upsert：已存在則更新 value、累加 sourceCount、提高 confidence
  await db
    .insert(memory)
    .values({
      userId,
      key,
      value,
      category,
      appName: appName ?? null,
      confidence: 0.5,
      sourceCount: 1,
    })
    .onConflictDoUpdate({
      target: [memory.userId, memory.category, memory.key],
      set: {
        value,
        sourceCount: sql`${memory.sourceCount} + 1`,
        confidence: sql`LEAST(1.0, ${memory.confidence} + 0.1)`,
        updatedAt: new Date(),
      },
    });

  // 更新 embedding（Drizzle 不原生支援 pgvector，用 raw SQL）
  if (embedding) {
    const vectorStr = toVectorString(embedding);
    await db.execute(sql`
      UPDATE memory
      SET embedding = ${vectorStr}::vector
      WHERE user_id = ${userId} AND category = ${category} AND key = ${key}
    `).catch((err) => console.error("Failed to store embedding:", err));
  }
}

// ============================================================
// 記憶刪除
// ============================================================

/** 刪除指定的記憶條目 */
export async function deleteMemory(
  userId: string,
  key: string,
  category: string,
): Promise<void> {
  await db
    .delete(memory)
    .where(
      and(
        eq(memory.userId, userId),
        eq(memory.key, key),
        eq(memory.category, category),
      ),
    );
}

// ============================================================
// 記憶列表
// ============================================================

/** 列出用戶的記憶，可按 category 篩選 */
export async function listMemory(
  userId: string,
  category?: string,
  limit = 50,
): Promise<MemoryEntry[]> {
  const conditions = [eq(memory.userId, userId)];
  if (category) {
    conditions.push(eq(memory.category, category));
  }

  return db
    .select({
      key: memory.key,
      value: memory.value,
      category: memory.category,
      appName: memory.appName,
      confidence: memory.confidence,
      lastUsedAt: memory.lastUsedAt,
    })
    .from(memory)
    .where(and(...conditions))
    .orderBy(desc(memory.updatedAt))
    .limit(limit);
}

// ============================================================
// 批量刪除 / 導出
// ============================================================

/** 刪除某個 App 的所有記憶 */
export async function deleteMemoryByApp(
  userId: string,
  appName: string,
): Promise<number> {
  const result = await db
    .delete(memory)
    .where(
      and(eq(memory.userId, userId), eq(memory.appName, appName)),
    )
    .returning({ id: memory.id });
  return result.length;
}

/** 刪除用戶的所有記憶 */
export async function deleteAllMemory(userId: string): Promise<number> {
  const result = await db
    .delete(memory)
    .where(eq(memory.userId, userId))
    .returning({ id: memory.id });
  return result.length;
}

/** 導出用戶的所有記憶 */
export async function exportMemory(userId: string): Promise<MemoryEntry[]> {
  return db
    .select({
      key: memory.key,
      value: memory.value,
      category: memory.category,
      appName: memory.appName,
      confidence: memory.confidence,
      lastUsedAt: memory.lastUsedAt,
    })
    .from(memory)
    .where(eq(memory.userId, userId))
    .orderBy(memory.category, memory.appName, memory.key);
}

// ============================================================
// 名稱 → ID 解析（do + help 架構核心）
// octodock_do 收到簡化參數（名字、代稱）時，查記憶表對應到實際 ID
// 例如：「會議」→ page_id: "317a9617..."
// ============================================================

/**
 * 從記憶中解析名稱到 ID
 * 查 category='context' 的記憶，key 格式為 "{entityType}:{name}"
 * 例如 key="folder:會議", value="317a9617-xxxx"
 *
 * @param userId 用戶 ID
 * @param name 要解析的名稱（例如 "會議"）
 * @param appName App 名稱（例如 "notion"）
 * @returns 解析結果，或 null 表示找不到
 */
export async function resolveIdentifier(
  userId: string,
  name: string,
  appName: string,
): Promise<{ id: string; type: string } | null> {
  // 先嘗試精確比對 key（最快）
  const exactResults = await db
    .select({
      key: memory.key,
      value: memory.value,
    })
    .from(memory)
    .where(
      and(
        eq(memory.userId, userId),
        eq(memory.category, "context"),
        eq(memory.appName, appName),
        // 搜尋 key 結尾是 :name 的記憶（例如 "folder:會議"）
        ilike(memory.key, `%:${escapeLike(name)}`),
      ),
    )
    .limit(1);

  if (exactResults.length > 0) {
    const entry = exactResults[0];
    // key 格式："{type}:{name}"，拆出 type
    const type = entry.key.split(":")[0];
    return { id: entry.value, type };
  }

  // 再嘗試模糊搜尋 value 欄位（可能記錄了名稱）
  const fuzzyResults = await db
    .select({
      key: memory.key,
      value: memory.value,
    })
    .from(memory)
    .where(
      and(
        eq(memory.userId, userId),
        eq(memory.category, "context"),
        eq(memory.appName, appName),
        ilike(memory.value, `%${escapeLike(name)}%`),
      ),
    )
    .limit(1);

  if (fuzzyResults.length > 0) {
    const entry = fuzzyResults[0];
    const type = entry.key.split(":")[0];
    return { id: entry.value, type };
  }

  return null;
}

/**
 * 學習新的名稱 → ID 對應（越用越懂你的機制）
 * 每次 octodock_do 成功執行後，自動記錄操作中出現的 ID 對應
 * 下次 AI 用名字操作時，就能自動解析
 *
 * @param userId 用戶 ID
 * @param appName App 名稱
 * @param name 人類可讀的名稱（例如頁面標題）
 * @param id 實際的 API ID
 * @param entityType 實體類型：page / database / folder / user
 */
export async function learnIdentifier(
  userId: string,
  appName: string,
  name: string,
  id: string,
  entityType: string,
): Promise<void> {
  // 用 storeMemory 的 upsert 機制，重複學習會提高 confidence
  await storeMemory(
    userId,
    `${entityType}:${name}`, // key 格式："{type}:{name}"
    id, // value 存實際 ID
    "context", // category 固定為 context
    appName,
  );
}
