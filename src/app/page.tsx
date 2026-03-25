import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { HomeClient } from "./home-client";
import { BASE_URL } from "@/lib/constants";

/** 首頁專屬 metadata — 覆寫 layout template，強化 Landing Page SEO */
export const metadata: Metadata = {
  title: "OctoDock — One MCP URL. All Apps. Remembers You.",
  description:
    "Connect Notion, Gmail, Google Calendar, GitHub, Drive, and 16+ apps through one MCP URL. Works with Claude, ChatGPT, Cursor, and any MCP-compatible AI. Cross-agent memory included.",
  alternates: { canonical: BASE_URL },
};

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  return <HomeClient />;
}
