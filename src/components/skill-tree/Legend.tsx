"use client";

/** 技能樹圖例 — 左下角，三層視覺層級 + 連接狀態 */

export function Legend() {
  return (
    <div className="fixed bottom-4 left-4 z-40 glass-panel rounded-lg px-4 py-3">
      <span className="font-mono text-[10px] text-gray-400 mb-2 block tracking-wider">LEGEND</span>
      <div className="space-y-2">
        {/* App 節點 */}
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded border-2 border-[#1D9E75] bg-[#F0FDF9]" />
          <span className="text-gray-600 text-xs">已連接 App</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded border-[1.5px] border-gray-300 bg-[#FAFAFA]" />
          <span className="text-gray-600 text-xs">未連接 App</span>
        </div>
        {/* Action 圓點 */}
        <div className="flex items-center gap-2.5">
          <div className="w-5 flex justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-[#1D9E75] opacity-70" />
          </div>
          <span className="text-gray-600 text-xs">已解鎖 Action</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="w-5 flex justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-[#CBD5E1] opacity-50" />
          </div>
          <span className="text-gray-600 text-xs">未解鎖 Action</span>
        </div>
        {/* 組合技 */}
        <div className="flex items-center gap-2.5">
          <div className="w-5 flex justify-center">
            <div className="w-3.5 h-3.5 border-[1.5px] border-dashed border-[#D4A843] bg-[#FFFDF5] rotate-45" />
          </div>
          <span className="text-gray-600 text-xs">組合技</span>
        </div>
        {/* U18/U19: 健康狀態燈號 */}
        <div className="border-t border-gray-200 pt-2 mt-1" />
        <span className="font-mono text-[10px] text-gray-400 mb-1 block tracking-wider">健康狀態</span>
        <div className="flex items-center gap-2.5">
          <div className="w-5 flex justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-[#22C55E]" />
          </div>
          <span className="text-gray-600 text-xs">運作良好 (≥95%)</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="w-5 flex justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-[#EAB308]" />
          </div>
          <span className="text-gray-600 text-xs">偶有錯誤 (80-94%)</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="w-5 flex justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-[#EF4444]" />
          </div>
          <span className="text-gray-600 text-xs">頻繁出錯 (&lt;80%)</span>
        </div>
      </div>
    </div>
  );
}
