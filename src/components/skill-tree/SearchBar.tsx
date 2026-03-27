"use client";

/** 技能樹搜尋欄 — 暗色主題 */

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

  const results = query.trim()
    ? nodes.filter(n =>
        n.label.toLowerCase().includes(query.toLowerCase()) ||
        (n.app && n.app.toLowerCase().includes(query.toLowerCase()))
      ).slice(0, 8)
    : [];

  useEffect(() => { onSearch(query); }, [query, onSearch]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className="fixed top-4 left-4 z-40 w-48 sm:w-64">
      {/* 搜尋框 */}
      <div className="rounded-lg flex items-center px-3 py-2 gap-2 border border-slate-700/50"
        style={{ background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)' }}
      >
        <Search size={14} className="text-slate-500 shrink-0" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search skills or apps…"
          className="bg-transparent text-sm text-slate-200 placeholder:text-slate-600 outline-none flex-1 font-mono"
        />
        {query && (
          <button onClick={() => { setQuery(''); setOpen(false); }} className="text-slate-500 hover:text-slate-300">
            <X size={14} />
          </button>
        )}
      </div>
      {/* 搜尋結果下拉 */}
      {open && results.length > 0 && (
        <div className="rounded-lg mt-1 py-1 max-h-60 overflow-y-auto border border-slate-700/50"
          style={{ background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(12px)' }}
        >
          {results.map(node => (
            <button
              key={node.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-800/50 transition-colors flex items-center gap-2"
              onClick={() => { onSelectNode(node); setQuery(''); setOpen(false); }}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                node.type === 'source' ? 'bg-emerald-400' :
                node.type === 'combo' ? 'bg-amber-400' :
                'bg-slate-500'
              }`} />
              <span className="text-slate-200">{node.label}</span>
              {node.app && node.type !== 'source' && (
                <span className="text-slate-600 text-xs ml-auto font-mono">{node.app}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
