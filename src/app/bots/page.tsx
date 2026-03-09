import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { botConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { BotsClient } from "./bots-client";

export default async function BotsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const configs = await db
    .select()
    .from(botConfigs)
    .where(eq(botConfigs.userId, session.user.id));

  const safe = configs.map((c) => ({
    id: c.id,
    platform: c.platform,
    platformBotId: c.platformBotId,
    systemPrompt: c.systemPrompt ?? "",
    llmProvider: c.llmProvider ?? "claude",
    hasLlmApiKey: !!c.llmApiKey,
    isActive: c.isActive ?? true,
  }));

  return <BotsClient configs={safe} />;
}
