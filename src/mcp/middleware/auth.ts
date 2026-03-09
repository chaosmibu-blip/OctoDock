import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

type User = { id: string; email: string; name: string | null };

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
