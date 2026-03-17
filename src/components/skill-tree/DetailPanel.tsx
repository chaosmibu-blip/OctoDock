"use client";

/** 技能詳情面板 — 從右側滑入，顯示節點的類型、狀態、描述、前置技能 */

import { SkillNode, NodeStatus } from '@/data/skillTreeData';
import { X, Check, AlertCircle } from 'lucide-react';

/* 狀態標籤對應 */
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  unlocked: { label: '已解鎖', color: 'text-[#1D9E75]' },
  pending: { label: '待精修', color: 'text-[#D4A843]' },
  locked: { label: '未解鎖', color: 'text-[#94A3B8]' },
};

/* 類型標籤對應 */
const TYPE_LABELS: Record<string, string> = {
  source: '源技能 (App)',
  skill: '技能 (API)',
  combo: '組合技',
};

interface Props {
  node: SkillNode;
  allNodes: SkillNode[];
  effectiveStatus: (id: string) => NodeStatus;
  onClose: () => void;
}

export function DetailPanel({ node, allNodes, effectiveStatus, onClose }: Props) {
  const nodeStatus = effectiveStatus(node.id);
  const status = STATUS_LABELS[nodeStatus];
  const prereqs = node.prerequisites?.map(id => allNodes.find(n => n.id === id)).filter(Boolean) as SkillNode[];

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />
      {/* 面板 */}
      <div className="fixed right-0 top-0 h-full w-80 bg-white border-l border-gray-200 z-50 flex flex-col shadow-lg">
        {/* 標題列 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-gray-900 font-semibold text-base">{node.label}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 transition-colors">
            <X size={18} />
          </button>
        </div>
        {/* 內容 */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <span className="font-mono text-xs text-gray-400">類型</span>
            <p className="text-gray-900 text-sm mt-1">{TYPE_LABELS[node.type]}</p>
          </div>
          <div>
            <span className="font-mono text-xs text-gray-400">狀態</span>
            <p className={`text-sm mt-1 font-semibold ${status.color}`}>{status.label}</p>
          </div>
          <div>
            <span className="font-mono text-xs text-gray-400">描述</span>
            <p className="text-gray-700 text-sm mt-1 leading-relaxed">{node.description}</p>
          </div>
          {/* 前置技能 */}
          {prereqs && prereqs.length > 0 && (
            <div>
              <span className="font-mono text-xs text-gray-400">前置技能</span>
              <ul className="mt-2 space-y-2">
                {prereqs.map(p => {
                  const pEffective = effectiveStatus(p.id);
                  const satisfied = pEffective !== 'locked';
                  return (
                    <li key={p.id} className="flex items-center gap-2 text-sm">
                      {node.type === 'combo' ? (
                        satisfied ? (
                          <Check size={14} className="text-[#1D9E75] shrink-0" />
                        ) : (
                          <AlertCircle size={14} className="text-red-500 shrink-0" />
                        )
                      ) : (
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          pEffective === 'unlocked' ? 'bg-[#1D9E75]' :
                          pEffective === 'pending' ? 'bg-[#D4A843]' : 'bg-[#CBD5E1]'
                        }`} />
                      )}
                      <span className="text-gray-700">{p.label}</span>
                      {p.app && (
                        <span className="text-gray-400 text-xs font-mono ml-auto">{p.app}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {/* 所屬 App */}
          {node.app && node.type !== 'source' && (
            <div>
              <span className="font-mono text-xs text-gray-400">所屬 App</span>
              <p className="text-gray-900 text-sm mt-1">{node.app}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
