import { db } from "@/db";
import { memory } from "@/db/schema";
import { and, eq, ilike, or, desc, sql } from "drizzle-orm";
import { getEmbedding, toVectorString } from "./embedding";

export interface MemoryEntry {
  key: string;
  value: string;
  category: string;
  appName: string | null;
  confidence: number | null;
  lastUsedAt: Date | null;
}

export async function queryMemory(
  userId: string,
  query: string,
  category?: string,
  appName?: string,
  limit = 10,
): Promise<MemoryEntry[]> {
  // Try semantic search first
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

  // Fallback: text-based search
  return textQuery(userId, query, category, appName, limit);
}

async function semanticQuery(
  userId: string,
  embedding: number[],
  category?: string,
  appName?: string,
  limit = 10,
): Promise<MemoryEntry[]> {
  const vectorStr = toVectorString(embedding);

  // Build WHERE conditions
  let where = sql`user_id = ${userId} AND embedding IS NOT NULL`;
  if (category) where = sql`${where} AND category = ${category}`;
  if (appName) where = sql`${where} AND app_name = ${appName}`;

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
  return rows.filter(
    (r) => r.similarity > 0.3, // Only return reasonably similar results
  );
}

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

  if (query) {
    conditions.push(
      or(
        ilike(memory.key, `%${query}%`),
        ilike(memory.value, `%${query}%`),
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

function updateLastUsed(userId: string, results: MemoryEntry[]): void {
  if (results.length === 0) return;
  const keys = results.map((r) => r.key);
  db.update(memory)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(memory.userId, userId),
        sql`${memory.key} = ANY(${keys})`,
      ),
    )
    .catch((err) => console.error("Failed to update lastUsedAt:", err));
}

export async function storeMemory(
  userId: string,
  key: string,
  value: string,
  category: string,
  appName?: string,
): Promise<void> {
  // Generate embedding asynchronously — don't block the store
  const embeddingText = `${key}: ${value}`;
  const embedding = await getEmbedding(embeddingText);

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

  // Update embedding via raw SQL (Drizzle doesn't natively support pgvector)
  if (embedding) {
    const vectorStr = toVectorString(embedding);
    await db.execute(sql`
      UPDATE memory
      SET embedding = ${vectorStr}::vector
      WHERE user_id = ${userId} AND category = ${category} AND key = ${key}
    `).catch((err) => console.error("Failed to store embedding:", err));
  }
}

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
