import { SkillTreeCanvas } from "@/components/skill-tree/SkillTreeCanvas";
import type { Metadata } from "next";

/** 登入後頁面不索引 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** 技能樹頁面 — 展示所有 App 技能的互動式技能樹 */
export default function SkillTreePage() {
  return <SkillTreeCanvas />;
}
