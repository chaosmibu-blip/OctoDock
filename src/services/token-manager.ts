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

  // Check if token is expired and needs refresh
  if (app.tokenExpiresAt && app.tokenExpiresAt < new Date()) {
    if (app.refreshToken) {
      return await refreshAndUpdateToken(userId, appName, app.refreshToken);
    }
    throw new Error(
      `${appName} token has expired and no refresh token available (${appName.toUpperCase()}_TOKEN_EXPIRED)`,
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
}
