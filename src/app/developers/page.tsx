/**
 * 開發者入口頁面
 * /developers — 請求新 App 或提交 Adapter，不需要登入
 */
import type { Metadata } from "next";
import { BASE_URL } from "@/lib/constants";
import { DevelopersClient } from "./developers-client";

export const metadata: Metadata = {
  title: "Developer Portal | OctoDock",
  description: "Request a new App integration or submit your own adapter for OctoDock.",
  alternates: { canonical: `${BASE_URL}/developers` },
};

export default function DevelopersPage() {
  return <DevelopersClient />;
}
