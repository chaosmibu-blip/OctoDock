import { db } from "@/db";
import { users, oauthTokens } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";

// ============================================================
// MCP 認證中介層
// 支援兩種認證方式：
// 1. API key（ak_xxx）— 從 URL path 驗證
// 2. Bearer token（oat_xxx）— 從 Authorization header 驗證（U24: OAuth Provider）
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
  try {
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
  } catch (error) {
    // API key 認證過程發生錯誤，回傳 null 視為認證失敗
    console.error("[AUTH] API key 認證失敗", error);
    return null;
  }
}

/**
 * U24: 根據 OAuth Bearer token 驗證並取得用戶資訊
 * Bearer token 格式：oat_ + 隨機字串，存在 oauth_tokens 表
 *
 * @param bearerToken Authorization header 中的 Bearer token
 * @returns 用戶資訊，或 null 表示 token 無效或過期
 */
export async function authenticateByBearerToken(
  bearerToken: string,
): Promise<User | null> {
  try {
    // 查 oauth_tokens 表，檢查 token 是否存在且未過期
    const tokenRows = await db.select({
      userId: oauthTokens.userId,
    })
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.accessToken, bearerToken),
          gt(oauthTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (tokenRows.length === 0) return null;

    // 取得用戶資訊
    const userRows = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
      .from(users)
      .where(eq(users.id, tokenRows[0].userId))
      .limit(1);

    return userRows[0] ?? null;
  } catch (error) {
    // Bearer token 認證過程發生錯誤，回傳 null 視為認證失敗
    console.error("[AUTH] Bearer token 認證失敗", error);
    return null;
  }
}
