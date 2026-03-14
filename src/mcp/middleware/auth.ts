import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

// ============================================================
// MCP 認證中介層
// 用 API key（ak_xxx）驗證用戶身份
// 每個用戶在第一次登入時自動產生 API key，貼到 AI 平台就能連
// ============================================================

type User = { id: string; email: string; name: string | null };

/**
 * 根據 MCP API key 驗證並取得用戶資訊
 * API key 格式：ak_ + 隨機字串，存在 users 表的 mcp_api_key 欄位
 *
 * @param apiKey MCP URL 中的 API key
 * @returns 用戶資訊，或 null 表示 key 無效
 */
export async function authenticateByApiKey(
  apiKey: string,
): Promise<User | null> {
  const result = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.mcpApiKey, apiKey))
    .limit(1);

  return result[0] ?? null;
}
