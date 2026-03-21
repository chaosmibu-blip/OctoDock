import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { schedules } from "@/db/schema";
import { eq } from "drizzle-orm";
import { SchedulesClient } from "./schedules-client";

// ============================================================
// 排程管理頁面
// 列出用戶的所有排程，可啟停和刪除
// ============================================================

export default async function SchedulesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const rows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.userId, session.user.id));

  return (
    <SchedulesClient
      schedules={rows.map((s) => ({
        id: s.id,
        name: s.name,
        cronExpression: s.cronExpression,
        timezone: s.timezone ?? "Asia/Taipei",
        actionType: s.actionType,
        actionConfig: s.actionConfig as Record<string, unknown>,
        isActive: s.isActive ?? true,
        lastRunAt: s.lastRunAt?.toISOString() ?? null,
        lastRunResult: s.lastRunResult as Record<string, unknown> | null,
        nextRunAt: s.nextRunAt?.toISOString() ?? null,
        createdAt: s.createdAt?.toISOString() ?? "",
      }))}
    />
  );
}
