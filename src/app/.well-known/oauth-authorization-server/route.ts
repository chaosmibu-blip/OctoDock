/**
 * U24: OAuth Authorization Server Metadata
 * GET /.well-known/oauth-authorization-server
 *
 * RFC 8414 — 讓 Claude Connectors Directory 等外部平台
 * 自動發現 OctoDock 的 OAuth 端點
 */

import { NextResponse } from "next/server";

/** OAuth 伺服器的公開域名 */
const ISSUER = "https://octo-dock.com";

export async function GET() {
  return NextResponse.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    scopes_supported: ["mcp"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    code_challenge_methods_supported: ["S256"],
  }, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400", // 24 小時快取
    },
  });
}
