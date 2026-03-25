import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { OperationsClient } from "./operations-client";

/** 操作歷史頁面 — 事件圖譜的用戶介面 */
export default async function OperationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return <OperationsClient />;
}
