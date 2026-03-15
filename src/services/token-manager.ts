import { db } from "@/db";
import { connectedApps } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";
import { getAdapter } from "@/mcp/registry";

export async function getValidToken(
  userId: string,
  appName: string,
): Promise<string> {
  const result = await db
    .select()
    .from(connectedApps)
    .where(
      and(eq(connectedApps.userId, userId), eq(connectedApps.appName, appName)),
    )
    .limit(1);

  const app = result[0];
  if (!app) {
    throw new Error(
      `${appName} is not connected (${appName.toUpperCase()}_NOT_CONNECTED)`,
    );
  }

  if (app.status !== "active") {
    throw new Error(
      `${appName} connection is ${app.status} (${appName.toUpperCase()}_${app.status?.toUpperCase()})`,
    );
  }

  // 提前 5 分鐘 refresh，避免在請求中段過期
  const REFRESH_BUFFER_MS = 5 * 60 * 1000;
  if (app.tokenExpiresAt && app.tokenExpiresAt.getTime() - REFRESH_BUFFER_MS < Date.now()) {
    // For Meta apps (threads/instagram), the access_token itself is the refresh token
    const refreshSource = app.refreshToken ?? app.accessToken;
    if (refreshSource) {
      return await refreshAndUpdateToken(userId, appName, refreshSource);
    }
    // Mark as expired in DB
    await db
      .update(connectedApps)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(eq(connectedApps.userId, userId), eq(connectedApps.appName, appName)),
      );
    throw new Error(
      `${appName} token has expired. Please reconnect in Dashboard. (${appName.toUpperCase()}_TOKEN_EXPIRED)`,
    );
  }

  return decrypt(app.accessToken);
}

async function refreshAndUpdateToken(
  userId: string,
  appName: string,
  encryptedRefreshToken: string,
): Promise<string> {
  const adapter = getAdapter(appName);
  if (!adapter?.refreshToken) {
    throw new Error(
      `${appName} adapter does not support token refresh (${appName.toUpperCase()}_REFRESH_NOT_SUPPORTED)`,
    );
  }

  const refreshToken = decrypt(encryptedRefreshToken);

  try {
    const tokenSet = await adapter.refreshToken(refreshToken);

    await db
      .update(connectedApps)
      .set({
        accessToken: encrypt(tokenSet.access_token),
        refreshToken: tokenSet.refresh_token
          ? encrypt(tokenSet.refresh_token)
          : undefined,
        tokenExpiresAt: tokenSet.expires_in
          ? new Date(Date.now() + tokenSet.expires_in * 1000)
          : undefined,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(eq(connectedApps.userId, userId), eq(connectedApps.appName, appName)),
      );

    return tokenSet.access_token;
  } catch (error) {
    // Mark as expired on refresh failure
    await db
      .update(connectedApps)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(eq(connectedApps.userId, userId), eq(connectedApps.appName, appName)),
      );
    throw new Error(
      `${appName} token refresh failed. Please reconnect in Dashboard. (${appName.toUpperCase()}_REFRESH_FAILED)`,
    );
  }
}
