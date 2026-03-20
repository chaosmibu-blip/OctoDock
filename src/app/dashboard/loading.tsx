// Dashboard 載入骨架屏 — DB 查詢期間顯示
export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-[#faf9f6] py-6 px-4">
      <div className="max-w-4xl mx-auto space-y-5 animate-pulse">
        {/* Nav bar 骨架 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gray-200 rounded-lg" />
            <div className="w-24 h-6 bg-gray-200 rounded" />
          </div>
          <div className="flex gap-2">
            <div className="w-16 h-7 bg-gray-200 rounded-lg" />
            <div className="w-12 h-7 bg-gray-200 rounded-lg" />
          </div>
        </div>

        {/* 用戶資訊骨架 */}
        <div className="w-48 h-4 bg-gray-200 rounded" />

        {/* MCP URL 骨架 */}
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <div className="w-full h-5 bg-gray-100 rounded" />
        </div>

        {/* App 卡片骨架 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
              <div className="w-24 h-4 bg-gray-200 rounded" />
              <div className="w-full h-3 bg-gray-100 rounded" />
              <div className="w-16 h-3 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
