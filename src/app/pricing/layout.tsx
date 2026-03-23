/* Pricing 頁面的 metadata（因為 page.tsx 是 client component，metadata 需要在 server layout） */
import type { Metadata } from "next";
import { BASE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Pricing - OctoDock",
  description: "OctoDock subscription plans — Free, Pro, and Team. One MCP URL for all your apps.",
  alternates: { canonical: `${BASE_URL}/pricing` },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
