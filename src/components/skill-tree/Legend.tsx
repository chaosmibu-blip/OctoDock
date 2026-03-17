"use client";

/** 技能樹圖例 — 左下角顯示各形狀 / 顏色的意義 */

export function Legend() {
  const items = [
    { shape: 'square', color: 'border-[#1D9E75]', label: '已連接 App' },
    { shape: 'square', color: 'border-[#CBD5E1]', label: '未連接 App' },
    { shape: 'circle', color: 'border-[#1D9E75]', label: '已解鎖技能' },
    { shape: 'circle', color: 'border-[#D4A843]', label: '待精修技能' },
    { shape: 'circle', color: 'border-[#CBD5E1]', label: '未解鎖技能' },
    { shape: 'diamond', color: 'border-[#D4A843]', label: '組合技' },
  ];

  return (
    <div className="fixed bottom-4 left-4 z-40 glass-panel rounded-lg px-4 py-3">
      <span className="font-mono text-xs text-gray-400 mb-2 block">圖例</span>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2.5">
            {item.shape === 'square' && (
              <div className={`w-3.5 h-3.5 border-2 ${item.color} bg-white`} />
            )}
            {item.shape === 'circle' && (
              <div className={`w-3.5 h-3.5 rounded-full border-2 ${item.color} bg-white`} />
            )}
            {item.shape === 'diamond' && (
              <div className={`w-3.5 h-3.5 border-2 ${item.color} bg-white rotate-45`} />
            )}
            <span className="text-gray-700 text-xs">{item.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-2.5 mt-1">
          <div className="w-5 h-0 border-t-2 border-dashed border-[#D4A843]" />
          <span className="text-gray-700 text-xs">組合技路線</span>
        </div>
      </div>
    </div>
  );
}
