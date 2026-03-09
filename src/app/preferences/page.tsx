import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listMemory } from "@/services/memory-engine";
import { PreferencesClient } from "./preferences-client";

export default async function PreferencesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const memories = await listMemory(session.user.id);

  return (
    <PreferencesClient
      memories={memories.map((m) => ({
        key: m.key,
        value: m.value,
        category: m.category,
        appName: m.appName,
        confidence: m.confidence,
      }))}
    />
  );
}
