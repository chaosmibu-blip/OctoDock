import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { inferPreferences } from "@/services/preference-inference";

// POST /api/infer — Trigger preference inference for the current user
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const count = await inferPreferences(session.user.id);
  return NextResponse.json({ success: true, memoriesStored: count });
}
