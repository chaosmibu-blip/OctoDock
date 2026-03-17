"use client";

/**
 * 技能樹主畫布 — 從 /api/skills 取得真實資料，SVG 拖拽/縮放/hover/點擊互動
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { buildSkillTree, SkillNode, SkillEdge, SkillsApiApp, SkillsApiCombo } from '@/data/skillTreeData';
import { DetailPanel } from './DetailPanel';
import { ProgressBar } from './ProgressBar';
import { Legend } from './Legend';
import { SearchBar } from './SearchBar';
import { ConnectDialog } from './ConnectDialog';

/* 節點狀態對應的顏色 */
const NODE_COLORS = {
  unlocked: '#1D9E75',
  locked: '#CBD5E1',
};

/* 邊的顏色 */
const EDGE_COLORS = {
  active: '#1D9E75',
  inactive: '#E2E8F0',
  combo: '#D4A843',
};

export function SkillTreeCanvas() {
  /* ── API 資料 ── */
  const [apps, setApps] = useState<SkillsApiApp[]>([]);
  const [combos, setCombos] = useState<SkillsApiCombo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── 互動狀態 ── */
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: -200, y: -50 });
  const [zoom, setZoom] = useState(0.75);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<SkillNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [connectTarget, setConnectTarget] = useState<SkillNode | null>(null);

  /* ── 載入 API 資料 ── */
  useEffect(() => {
    fetch('/api/skills')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        setApps(data.apps);
        setCombos(data.combos ?? []);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  /* ── 根據 API 資料動態建構節點和邊 ── */
  const { nodes, edges } = useMemo(() => {
    if (apps.length === 0) return { nodes: [], edges: [] };
    return buildSkillTree(apps, combos);
  }, [apps, combos]);

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  /* 已連接 App 的 Set */
  const connectedApps = useMemo(
    () => new Set(apps.filter(a => a.connected).map(a => a.name)),
    [apps],
  );

  /* ── 搜尋篩選 ── */
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return new Set(nodes.filter(n =>
      n.label.toLowerCase().includes(q) ||
      (n.app && n.app.toLowerCase().includes(q))
    ).map(n => n.id));
  }, [searchQuery, nodes]);

  /* hover 時高亮相關邊和節點 */
  const highlightedEdges = hoveredNode
    ? new Set(edges.filter(e => e.from === hoveredNode || e.to === hoveredNode).map(e => `${e.from}-${e.to}`))
    : new Set<string>();
  const highlightedNodes = hoveredNode
    ? new Set(edges.filter(e => e.from === hoveredNode || e.to === hoveredNode).flatMap(e => [e.from, e.to]))
    : new Set<string>();

  /* ── 滾輪縮放 ── */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.min(2, Math.max(0.3, z * delta)));
  }, []);

  /* ── 拖拽平移 ── */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  }, [dragging, dragStart]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  /* ── 觸控支援 ── */
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchRef.current = { x: t.clientX - pan.x, y: t.clientY - pan.y };
    }
  }, [pan]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1 && touchRef.current) {
      const t = e.touches[0];
      setPan({ x: t.clientX - touchRef.current.x, y: t.clientY - touchRef.current.y });
    }
  }, []);

  /* ── 點擊節點 ── */
  const handleNodeClick = useCallback((e: React.MouseEvent, node: SkillNode) => {
    e.stopPropagation();
    if (node.type === 'source') {
      /* 點擊 App 節點 → 開啟連接/中斷對話框 */
      setConnectTarget(node);
    } else {
      /* 點擊技能/組合技節點 → 開啟詳情面板 */
      setSelectedNode(node);
    }
  }, []);

  /* ── 連接確認 → 導向 OAuth 或其他流程 ── */
  const handleConnect = useCallback((appName: string, authType: string) => {
    if (authType === 'oauth2') {
      /* OAuth2 → 直接導向 /api/connect/{app} */
      window.location.href = `/api/connect/${appName}`;
    }
    /* bot_token / api_key 的情況由 ConnectDialog 內部處理 */
  }, []);

  /* ── 中斷連接 ── */
  const handleDisconnect = useCallback(async (appName: string) => {
    await fetch(`/api/connect/${appName}`, { method: 'DELETE' });
    /* 重新載入資料（包含 combos 的 unlocked 狀態也會更新） */
    const res = await fetch('/api/skills');
    if (res.ok) {
      const data = await res.json();
      setApps(data.apps);
      setCombos(data.combos ?? []);
    }
    setConnectTarget(null);
  }, []);

  /* ── 搜尋選取 → 平移視口到該節點 ── */
  const handleSearchSelect = useCallback((node: SkillNode) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const targetZoom = 1;
    setPan({
      x: rect.width / 2 - node.x * targetZoom,
      y: rect.height / 2 - node.y * targetZoom,
    });
    setZoom(targetZoom);
    setSearchQuery('');
  }, []);

  /* ── 邊的顏色計算 ── */
  const getEdgeColor = (edge: SkillEdge) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) return EDGE_COLORS.inactive;

    if (edge.type === 'combo') {
      return from.status === 'unlocked' && to.status === 'unlocked'
        ? EDGE_COLORS.combo : EDGE_COLORS.inactive;
    }
    if (from.status === 'unlocked' && to.status === 'unlocked') return EDGE_COLORS.active;
    return EDGE_COLORS.inactive;
  };

  const isEdgeHighlighted = (edge: SkillEdge) => highlightedEdges.has(`${edge.from}-${edge.to}`);

  /* ── 渲染邊 ── */
  const renderEdge = (edge: SkillEdge, i: number) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) return null;

    const color = getEdgeColor(edge);
    const highlighted = isEdgeHighlighted(edge);
    const isCombo = edge.type === 'combo';

    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const cx = mx - dy * 0.15;
    const cy = my + dx * 0.15;

    return (
      <g key={`edge-${i}`}>
        <path
          d={`M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`}
          stroke={highlighted ? (isCombo ? '#D4A843' : '#1D9E75') : color}
          strokeWidth={highlighted ? 2.5 : 1.5}
          strokeDasharray={isCombo ? '8 4' : 'none'}
          fill="none"
          opacity={hoveredNode ? (highlighted ? 1 : 0.15) : (color === EDGE_COLORS.inactive ? 0.3 : 0.6)}
          style={
            color === EDGE_COLORS.active && !hoveredNode
              ? { filter: 'drop-shadow(0 0 4px rgba(29,158,117,0.4))' }
              : highlighted && !isCombo
              ? { filter: 'drop-shadow(0 0 6px rgba(29,158,117,0.6))' }
              : highlighted && isCombo
              ? { filter: 'drop-shadow(0 0 6px rgba(212,168,67,0.5))' }
              : {}
          }
        />
      </g>
    );
  };

  /* ── 渲染節點 ── */
  const renderNode = (node: SkillNode) => {
    const color = NODE_COLORS[node.status];
    const dimmedByHover = hoveredNode && !highlightedNodes.has(node.id) && hoveredNode !== node.id;
    const dimmedBySearch = searchMatches && !searchMatches.has(node.id);
    const baseOpacity = dimmedByHover ? 0.2 : dimmedBySearch ? 0.15 : 1;

    const isHovered = hoveredNode === node.id;
    const isSelected = selectedNode?.id === node.id;

    /* Source 節點（App）— 正方形 */
    if (node.type === 'source') {
      const size = 32;
      const isConnected = node.status === 'unlocked';
      return (
        <g
          key={node.id}
          opacity={baseOpacity}
          style={{ cursor: 'pointer', transition: 'opacity 150ms' }}
          onClick={(e) => handleNodeClick(e, node)}
          onMouseEnter={() => setHoveredNode(node.id)}
          onMouseLeave={() => setHoveredNode(null)}
        >
          <rect
            x={node.x - size} y={node.y - size}
            width={size * 2} height={size * 2}
            fill={isConnected ? '#FFFFFF' : '#F8FAFC'}
            stroke={isConnected ? color : '#94A3B8'}
            strokeWidth={isHovered || isSelected ? 3 : 2}
            style={isHovered && isConnected ? { filter: 'drop-shadow(0 0 10px rgba(29,158,117,0.5))' } : {}}
          />
          <text
            x={node.x} y={node.y + 1}
            textAnchor="middle" dominantBaseline="middle"
            fill={isConnected ? '#1E293B' : '#94A3B8'}
            fontSize={11} fontWeight={600}
            fontFamily="Inter, sans-serif"
          >
            {node.label}
          </text>
          <text
            x={node.x} y={node.y + size + 18}
            textAnchor="middle" dominantBaseline="middle"
            fill={isConnected ? '#64748B' : '#94A3B8'}
            fontSize={9}
            fontFamily="JetBrains Mono, monospace"
          >
            {isConnected ? 'CONNECTED' : 'CLICK TO CONNECT'}
          </text>
        </g>
      );
    }

    /* Combo 節點（組合技）— 菱形 */
    if (node.type === 'combo') {
      const size = 24;
      const points = `${node.x},${node.y - size} ${node.x + size},${node.y} ${node.x},${node.y + size} ${node.x - size},${node.y}`;
      const isActive = node.status === 'unlocked';
      return (
        <g
          key={node.id}
          opacity={baseOpacity}
          style={{ cursor: 'pointer', transition: 'opacity 150ms' }}
          onClick={(e) => handleNodeClick(e, node)}
          onMouseEnter={() => setHoveredNode(node.id)}
          onMouseLeave={() => setHoveredNode(null)}
        >
          <polygon
            points={points}
            fill={isActive ? '#FFFFF5' : '#F8FAFC'}
            stroke={isActive ? '#D4A843' : '#CBD5E1'}
            strokeWidth={isHovered || isSelected ? 3 : 2}
            strokeDasharray="6 3"
            style={isHovered && isActive ? { filter: 'drop-shadow(0 0 10px rgba(212,168,67,0.5))' } : {}}
          />
          <text
            x={node.x} y={node.y + size + 16}
            textAnchor="middle" dominantBaseline="middle"
            fill={isActive ? '#D4A843' : '#94A3B8'}
            fontSize={9} fontWeight={500}
            fontFamily="JetBrains Mono, monospace"
          >
            {node.label}
          </text>
        </g>
      );
    }

    /* Skill 節點（action）— 圓形 */
    const r = 20;
    const isUnlocked = node.status === 'unlocked';
    return (
      <g
        key={node.id}
        opacity={baseOpacity}
        style={{ cursor: 'pointer', transition: 'opacity 150ms' }}
        onClick={(e) => handleNodeClick(e, node)}
        onMouseEnter={() => setHoveredNode(node.id)}
        onMouseLeave={() => setHoveredNode(null)}
      >
        <circle
          cx={node.x} cy={node.y} r={r}
          fill="#FFFFFF"
          stroke={color}
          strokeWidth={isHovered || isSelected ? 3 : 2}
          style={
            isHovered && isUnlocked
              ? { filter: 'drop-shadow(0 0 8px rgba(29,158,117,0.5))' }
              : {}
          }
        />
        <circle
          cx={node.x} cy={node.y} r={5}
          fill={color}
          opacity={isUnlocked ? 0.8 : 0.3}
        />
        <text
          x={node.x} y={node.y + r + 14}
          textAnchor="middle" dominantBaseline="middle"
          fill={isUnlocked ? '#1E293B' : '#94A3B8'}
          fontSize={9} fontWeight={500}
          fontFamily="JetBrains Mono, monospace"
        >
          {node.label}
        </text>
      </g>
    );
  };

  /* ── 進度統計：已連接 App 數 / 總 App 數 ── */
  const connectedCount = connectedApps.size;
  const totalApps = apps.length;

  /* ── Loading 狀態 ── */
  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-screen bg-white">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-gray-200 border-t-[#1D9E75] rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 font-mono text-sm">載入技能樹…</p>
        </div>
      </div>
    );
  }

  /* ── Error 狀態 ── */
  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-screen bg-white">
        <div className="text-center space-y-3 max-w-md px-4">
          <p className="text-red-500 font-semibold">載入失敗</p>
          <p className="text-gray-400 text-sm">{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); window.location.reload(); }}
            className="px-4 py-2 bg-black text-white text-sm rounded-md hover:bg-gray-800"
          >
            重試
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-white select-none">
      <div
        ref={containerRef}
        className="w-full h-full"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => { touchRef.current = null; }}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
          <defs>
            <pattern id="dotGrid" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="12" cy="12" r="1.5" fill="#E0E0E0" />
            </pattern>
          </defs>
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            <rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#dotGrid)" />
            {edges.map((e, i) => renderEdge(e, i))}
            {nodes.map(renderNode)}
          </g>
        </svg>
      </div>

      {/* UI 覆蓋層 */}
      <SearchBar nodes={nodes} onSearch={setSearchQuery} onSelectNode={handleSearchSelect} />
      <ProgressBar unlocked={connectedCount} total={totalApps} />
      <Legend />

      {/* 詳情面板 */}
      {selectedNode && (
        <DetailPanel
          node={selectedNode}
          allNodes={nodes}
          connectedApps={connectedApps}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {/* 連接 / 中斷對話框 */}
      {connectTarget && (
        <ConnectDialog
          node={connectTarget}
          isConnected={connectedApps.has(connectTarget.id)}
          open={!!connectTarget}
          onOpenChange={(open) => { if (!open) setConnectTarget(null); }}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />
      )}
    </div>
  );
}
