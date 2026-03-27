"use client";

/** 技能樹進度條 — 右上角，暗色主題 */

interface Props {
  unlocked: number;
  total: number;
  recommendation?: { appName: string; reason: string } | null;
  onRecommendationClick?: (appName: string) => void;
}

export function ProgressBar({ unlocked, total, recommendation, onRecommendationClick }: Props) {
  const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;

  return (
    <div className="fixed top-14 right-4 sm:top-4 z-40 rounded-lg px-3 py-2.5 sm:px-4 sm:py-3 min-w-[160px] sm:min-w-[220px] max-w-[200px] sm:max-w-[280px] border border-slate-700/50"
      style={{ background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)' }}
    >
      {/* 進度 */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs text-slate-500">Connected</span>
        <span className="font-mono text-xs text-slate-200">
          {unlocked} <span className="text-slate-500">/ {total}</span>
        </span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, #059669, #34D399)',
            boxShadow: '0 0 12px rgba(52, 211, 153, 0.4)',
          }}
        />
      </div>

      {/* 推薦 */}
      {recommendation && unlocked < total && (
        <button
          onClick={() => onRecommendationClick?.(recommendation.appName)}
          className="mt-2.5 w-full text-left group"
        >
          <div className="text-[10px] text-slate-500 font-mono mb-0.5">NEXT UNLOCK</div>
          <div className="text-xs text-emerald-400 font-semibold group-hover:text-emerald-300 transition-colors">
            {recommendation.appName}
          </div>
          <div className="text-[10px] text-slate-500 leading-snug mt-0.5">
            {recommendation.reason}
          </div>
        </button>
      )}
    </div>
  );
}
