"use client";

/** 技能樹進度條 — 右上角顯示已解鎖 / 總數 */

interface Props {
  unlocked: number;
  total: number;
}

export function ProgressBar({ unlocked, total }: Props) {
  const pct = Math.round((unlocked / total) * 100);

  return (
    <div className="fixed top-4 right-4 z-40 glass-panel rounded-lg px-4 py-3 min-w-[200px]">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs text-gray-400">已解鎖</span>
        <span className="font-mono text-xs text-gray-900">
          {unlocked} <span className="text-gray-400">/ {total}</span>
        </span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#1D9E75] rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, boxShadow: '0 0 8px rgba(29,158,117,0.5)' }}
        />
      </div>
    </div>
  );
}
