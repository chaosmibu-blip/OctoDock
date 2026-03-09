import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, connectedApps } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DashboardClient } from "./dashboard-client";

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

  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  const origin = `${protocol}://${host}`;

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
    />
  );
}
