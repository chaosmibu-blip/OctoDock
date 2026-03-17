"use client";

/** 技能樹進度條 — 右上角顯示已連接進度 + 下一個推薦連接的 App */

interface Props {
  unlocked: number;
  total: number;
  recommendation?: { appName: string; reason: string } | null;
  onRecommendationClick?: (appName: string) => void;
}

export function ProgressBar({ unlocked, total, recommendation, onRecommendationClick }: Props) {
  const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;

  return (
    <div className="fixed top-4 right-4 z-40 glass-panel rounded-lg px-4 py-3 min-w-[220px] max-w-[280px]">
      {/* 進度 */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs text-gray-400">已連接</span>
        <span className="font-mono text-xs text-gray-900">
          {unlocked} <span className="text-gray-400">/ {total} Apps</span>
        </span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#1D9E75] rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, boxShadow: '0 0 8px rgba(29,158,117,0.5)' }}
        />
      </div>

      {/* 推薦 */}
      {recommendation && unlocked < total && (
        <button
          onClick={() => onRecommendationClick?.(recommendation.appName)}
          className="mt-2.5 w-full text-left group"
        >
          <div className="text-[10px] text-gray-400 font-mono mb-0.5">推薦連接</div>
          <div className="text-xs text-[#1D9E75] font-semibold group-hover:underline">
            {recommendation.appName}
          </div>
          <div className="text-[10px] text-gray-400 leading-snug mt-0.5">
            {recommendation.reason}
          </div>
        </button>
      )}
    </div>
  );
}
