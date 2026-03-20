"use client";

import Link from "next/link";

// Dashboard 錯誤邊界 — server component 出錯時顯示友善頁面
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#faf9f6] flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">
          載入失敗
        </h2>
        <p className="text-sm text-gray-500">
          {error.message || "無法載入 Dashboard，請稍後再試。"}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            重試
          </button>
          <Link
            href="/"
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
          >
            回首頁
          </Link>
        </div>
      </div>
    </div>
  );
}
