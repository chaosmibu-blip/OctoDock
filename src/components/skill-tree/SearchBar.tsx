"use client";

/** 技能樹搜尋欄 — 即時搜尋技能名稱或 App 名稱，選取後視口平移到該節點 */

import { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { SkillNode } from '@/data/skillTreeData';

interface Props {
  nodes: SkillNode[];
  onSearch: (query: string) => void;
  onSelectNode: (node: SkillNode) => void;
}

export function SearchBar({ nodes, onSearch, onSelectNode }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /* 篩選結果，最多顯示 8 筆 */
  const results = query.trim()
    ? nodes.filter(n =>
        n.label.toLowerCase().includes(query.toLowerCase()) ||
        (n.app && n.app.toLowerCase().includes(query.toLowerCase()))
      ).slice(0, 8)
    : [];

  /* 搜尋字串變更時通知父元件 */
  useEffect(() => {
    onSearch(query);
  }, [query, onSearch]);

  /* 點擊外部關閉下拉 */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className="fixed top-4 left-4 z-40 w-64">
      {/* 搜尋框 */}
      <div className="glass-panel rounded-lg flex items-center px-3 py-2 gap-2">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="搜尋技能或 App…"
          className="bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none flex-1 font-mono"
        />
        {query && (
          <button onClick={() => { setQuery(''); setOpen(false); }} className="text-gray-400 hover:text-gray-900">
            <X size={14} />
          </button>
        )}
      </div>
      {/* 搜尋結果下拉 */}
      {open && results.length > 0 && (
        <div className="glass-panel rounded-lg mt-1 py-1 max-h-60 overflow-y-auto">
          {results.map(node => (
            <button
              key={node.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 transition-colors flex items-center gap-2"
              onClick={() => { onSelectNode(node); setQuery(''); setOpen(false); }}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                node.type === 'source' ? 'bg-[#1D9E75]' :
                node.type === 'combo' ? 'bg-[#D4A843]' :
                'bg-gray-400'
              }`} />
              <span className="text-gray-900">{node.label}</span>
              {node.app && node.type !== 'source' && (
                <span className="text-gray-400 text-xs ml-auto font-mono">{node.app}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
