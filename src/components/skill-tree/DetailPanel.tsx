"use client";

/** 技能詳情面板 — 暗色主題，右側滑入 */

import { SkillNode } from '@/data/skillTreeData';
import { X, Check, AlertCircle } from 'lucide-react';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  unlocked: { label: 'Unlocked', color: 'text-emerald-400' },
  locked: { label: 'Locked', color: 'text-slate-500' },
};

const TYPE_LABELS: Record<string, string> = {
  source: 'App',
  skill: 'Action',
  combo: 'Combo',
};

interface Props {
  node: SkillNode;
  allNodes: SkillNode[];
  connectedApps: Set<string>;
  onClose: () => void;
}

export function DetailPanel({ node, allNodes, connectedApps, onClose }: Props) {
  const status = STATUS_LABELS[node.status] ?? STATUS_LABELS.locked;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-80 z-50 flex flex-col border-l border-slate-700/50"
        style={{ background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(20px)' }}
      >
        {/* 標題 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700/50">
          <h2 className="text-slate-100 font-semibold text-base">{node.label}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>
        {/* 內容 */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <span className="font-mono text-xs text-slate-500">TYPE</span>
            <p className="text-slate-200 text-sm mt-1">{TYPE_LABELS[node.type]}</p>
          </div>
          <div>
            <span className="font-mono text-xs text-slate-500">STATUS</span>
            <p className={`text-sm mt-1 font-semibold ${status.color}`}>{status.label}</p>
          </div>
          <div>
            <span className="font-mono text-xs text-slate-500">DESCRIPTION</span>
            <p className="text-slate-300 text-sm mt-1 leading-relaxed">{node.description}</p>
            {node.descriptionEn && (
              <p className="text-slate-500 text-xs mt-1 leading-relaxed">{node.descriptionEn}</p>
            )}
          </div>

          {/* 組合技前置條件 */}
          {node.prerequisites && node.prerequisites.length > 0 && (
            <div>
              <span className="font-mono text-xs text-slate-500">PREREQUISITES</span>
              <ul className="mt-2 space-y-2">
                {node.prerequisites.map(prereq => {
                  const isAppConnected = connectedApps.has(prereq.app);
                  const appNode = allNodes.find(n => n.id === prereq.app && n.type === 'source');
                  const appLabel = appNode?.label ?? prereq.app;

                  return (
                    <li key={prereq.nodeId} className="flex items-center gap-2 text-sm">
                      {isAppConnected ? (
                        <Check size={14} className="text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle size={14} className="text-red-400 shrink-0" />
                      )}
                      <span className="text-slate-300">{prereq.label}</span>
                      <span className="text-slate-600 text-xs font-mono ml-auto">{appLabel}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* 所屬 App */}
          {node.app && node.type === 'skill' && (
            <div>
              <span className="font-mono text-xs text-slate-500">APP</span>
              <p className="text-slate-200 text-sm mt-1">
                {allNodes.find(n => n.id === node.app && n.type === 'source')?.label ?? node.app}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
