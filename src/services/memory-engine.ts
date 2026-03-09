import { db } from "@/db";
import { memory } from "@/db/schema";
import { and, eq, ilike, or, desc, sql } from "drizzle-orm";

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
  const conditions = [eq(memory.userId, userId)];

  if (category) {
    conditions.push(eq(memory.category, category));
  }

  if (appName) {
    conditions.push(eq(memory.appName, appName));
  }

  // Text-based search (Phase 2 MVP — pgvector semantic search in Phase 3)
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

  // Update lastUsedAt for retrieved memories
  if (results.length > 0) {
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

  return results;
}

export async function storeMemory(
  userId: string,
  key: string,
  value: string,
  category: string,
  appName?: string,
): Promise<void> {
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
