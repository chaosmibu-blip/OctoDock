"use client";

/** 技能樹圖例 — 左下角，暗色主題 */

export function Legend() {
  return (
    <div className="fixed bottom-4 left-4 z-40 rounded-lg px-4 py-3 border border-slate-700/50"
      style={{ background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)' }}
    >
      <span className="font-mono text-[10px] text-slate-500 mb-2 block tracking-wider">LEGEND</span>
      <div className="space-y-2">
        {/* App 節點 */}
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded border border-emerald-500/60 bg-emerald-950/50" />
          <span className="text-slate-400 text-xs">Connected App</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded border border-slate-600 bg-slate-800/50" />
          <span className="text-slate-400 text-xs">Available App</span>
        </div>
        {/* Action 光點 */}
        <div className="flex items-center gap-2.5">
          <div className="w-5 flex justify-center">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
          </div>
          <span className="text-slate-400 text-xs">Used Action</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="w-5 flex justify-center">
            <div className="w-2 h-2 rounded-full bg-emerald-700 opacity-60" />
          </div>
          <span className="text-slate-400 text-xs">Available Action</span>
        </div>
        {/* 組合技 */}
        <div className="flex items-center gap-2.5">
          <div className="w-5 flex justify-center">
            <div className="w-3 h-3 border border-dashed border-amber-400/60 bg-amber-950/30 rotate-45" />
          </div>
          <span className="text-slate-400 text-xs">Combo</span>
        </div>
        {/* 健康狀態 */}
        <div className="border-t border-slate-700/50 pt-2 mt-1" />
        <span className="font-mono text-[10px] text-slate-500 mb-1 block tracking-wider">HEALTH</span>
        <div className="flex items-center gap-2.5">
          <div className="w-5 flex justify-center">
            <div className="w-2 h-2 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 6px rgba(52, 211, 153, 0.5)' }} />
          </div>
          <span className="text-slate-400 text-xs">Good (≥95%)</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="w-5 flex justify-center">
            <div className="w-2 h-2 rounded-full bg-amber-400" style={{ boxShadow: '0 0 6px rgba(251, 191, 36, 0.5)' }} />
          </div>
          <span className="text-slate-400 text-xs">Warning (80-94%)</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="w-5 flex justify-center">
            <div className="w-2 h-2 rounded-full bg-red-400" style={{ boxShadow: '0 0 6px rgba(248, 113, 113, 0.5)' }} />
          </div>
          <span className="text-slate-400 text-xs">Error (&lt;80%)</span>
        </div>
      </div>
    </div>
  );
}
