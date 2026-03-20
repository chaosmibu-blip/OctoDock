import Link from "next/link";

// 全域 404 頁面 — 統一品牌風格
export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#faf9f6] flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center space-y-4">
        <h1 className="text-6xl font-bold text-gray-200">404</h1>
        <h2 className="text-lg font-semibold text-gray-900">
          找不到此頁面
        </h2>
        <p className="text-sm text-gray-500">
          你要找的頁面不存在或已被移除。
        </p>
        <Link
          href="/"
          className="inline-block px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 transition-colors"
        >
          回首頁
        </Link>
      </div>
    </div>
  );
}
