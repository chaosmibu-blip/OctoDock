import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, connectedApps } from "@/db/schema";
import { eq } from "drizzle-orm";
import { BASE_URL } from "@/lib/constants";
import { DashboardClient } from "./dashboard-client";
import { getUsageSummary } from "@/mcp/middleware/usage-limit";

/* #7: 頁面專屬 metadata */
export const metadata: Metadata = {
  title: "Dashboard | OctoDock",
  description: "管理你的 MCP 連結、App 和 AI 工具設定",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user[0]) {
    redirect("/api/auth/signin");
  }

  const apps = await db
    .select()
    .from(connectedApps)
    .where(eq(connectedApps.userId, session.user.id));

  // MCP URL 固定使用正式域名，不從 request header 取
  // 確保用戶複製的 URL 永遠是 octo-dock.com，不會是 replit.app
  const origin = BASE_URL;

  // 取得用量摘要（用量條用）
  let usage: { plan: string; used: number; limit: number | null; month: string } = {
    plan: "free", used: 0, limit: 1000, month: "",
  };
  try {
    usage = await getUsageSummary(session.user.id);
  } catch {
    // 用量查詢失敗不影響 Dashboard 載入
  }

  return (
    <DashboardClient
      user={{
        name: user[0].name ?? session.user.name ?? "",
        email: user[0].email,
        mcpApiKey: user[0].mcpApiKey ?? "",
      }}
      connectedApps={apps.map((a) => ({
        appName: a.appName,
        status: a.status ?? "active",
        connectedAt: a.connectedAt?.toISOString() ?? "",
      }))}
      origin={origin}
      usage={usage}
    />
  );
}
