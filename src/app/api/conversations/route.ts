import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";

// GET /api/conversations?platform=line&platformUserId=xxx&limit=50
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const platform = searchParams.get("platform");
  const platformUserId = searchParams.get("platformUserId");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);

  const conditions = [eq(conversations.userId, session.user.id)];
  if (platform) conditions.push(eq(conversations.platform, platform));
  if (platformUserId)
    conditions.push(eq(conversations.platformUserId, platformUserId));

  const results = await db
    .select({
      id: conversations.id,
      platform: conversations.platform,
      platformUserId: conversations.platformUserId,
      role: conversations.role,
      content: conversations.content,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(and(...conditions))
    .orderBy(desc(conversations.createdAt))
    .limit(limit);

  return NextResponse.json(results);
}

// DELETE /api/conversations?platform=line&platformUserId=xxx
// Clear conversation history for a specific platform user
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const platform = searchParams.get("platform");
  const platformUserId = searchParams.get("platformUserId");

  const conditions = [eq(conversations.userId, session.user.id)];
  if (platform) conditions.push(eq(conversations.platform, platform));
  if (platformUserId)
    conditions.push(eq(conversations.platformUserId, platformUserId));

  await db.delete(conversations).where(and(...conditions));

  return NextResponse.json({ success: true });
}
