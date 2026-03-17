"use client";

/**
 * 技能樹主畫布 — SVG 拖拽/縮放/hover/點擊互動
 * 顯示所有 App cluster、技能節點、組合技節點及其連線
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import { nodes, edges, SkillNode, SkillEdge, NodeStatus } from '@/data/skillTreeData';
import { DetailPanel } from './DetailPanel';
import { ProgressBar } from './ProgressBar';
import { Legend } from './Legend';
import { SearchBar } from './SearchBar';
import { OAuthDialog } from './OAuthDialog';

/* 節點狀態對應的顏色 */
const NODE_COLORS: Record<NodeStatus, string> = {
  unlocked: '#1D9E75',
  pending: '#D4A843',
  locked: '#CBD5E1',
};

/* 邊的顏色 */
const EDGE_COLORS = {
  active: '#1D9E75',
  inactive: '#E2E8F0',
  combo: '#D4A843',
};

export function SkillTreeCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: -200, y: -50 });
  const [zoom, setZoom] = useState(0.75);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<SkillNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  /* 已連接的 App（預設假資料：Notion 和 Calendar 已連接） */
  const [connectedApps, setConnectedApps] = useState<Set<string>>(new Set(['notion', 'calendar']));
  const [oauthTarget, setOauthTarget] = useState<SkillNode | null>(null);

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), []);

  /** 根據 App 連接狀態，計算節點的實際狀態（遞迴函式，用於 combo 節點） */
  const getEffectiveStatus = useMemo(() => {
    const fn = (nodeId: string): NodeStatus => {
      const node = nodeMap.get(nodeId);
      if (!node) return 'locked';

      if (node.type === 'source') {
        return connectedApps.has(node.id) ? 'unlocked' : 'locked';
      }
      if (node.type === 'skill') {
        if (!node.app || !connectedApps.has(node.app)) return 'locked';
        return node.intrinsicStatus;
      }
      if (node.type === 'combo') {
        const allSatisfied = (node.prerequisites || []).every(preId => {
          const eff = fn(preId);
          return eff !== 'locked';
        });
        return allSatisfied ? 'unlocked' : 'locked';
      }
      return 'locked';
    };
    return fn;
  }, [connectedApps, nodeMap]);

  /* 搜尋篩選 */
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return new Set(nodes.filter(n =>
      n.label.toLowerCase().includes(q) ||
      (n.app && n.app.toLowerCase().includes(q))
    ).map(n => n.id));
  }, [searchQuery]);

  /* hover 時高亮相關邊和節點 */
  const highlightedEdges = hoveredNode
    ? new Set(edges.filter(e => e.from === hoveredNode || e.to === hoveredNode).map(e => `${e.from}-${e.to}`))
    : new Set<string>();
  const highlightedNodes = hoveredNode
    ? new Set(edges.filter(e => e.from === hoveredNode || e.to === hoveredNode).flatMap(e => [e.from, e.to]))
    : new Set<string>();

  /* 滾輪縮放 */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.min(2, Math.max(0.3, z * delta)));
  }, []);

  /* 拖拽平移 */
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

  /* 觸控支援 */
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

  /* 點擊節點 — source 節點開啟連接對話框，其他開啟詳情面板 */
  const handleNodeClick = useCallback((e: React.MouseEvent, node: SkillNode) => {
    e.stopPropagation();
    if (node.type === 'source') {
      setOauthTarget(node);
    } else {
      setSelectedNode(node);
    }
  }, []);

  /* OAuth 確認 — 切換 App 連接狀態 */
  const handleOAuthConfirm = useCallback(() => {
    if (!oauthTarget) return;
    setConnectedApps(prev => {
      const next = new Set(prev);
      if (next.has(oauthTarget.id)) {
        next.delete(oauthTarget.id);
      } else {
        next.add(oauthTarget.id);
      }
      return next;
    });
  }, [oauthTarget]);

  /* 搜尋選取 — 將視口平移到選中節點 */
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

  /** 計算邊的顏色 */
  const getEdgeColor = (edge: SkillEdge) => {
    const fromStatus = getEffectiveStatus(edge.from);
    const toStatus = getEffectiveStatus(edge.to);
    if (edge.type === 'combo') {
      return fromStatus !== 'locked' && toStatus !== 'locked' ? EDGE_COLORS.combo : EDGE_COLORS.inactive;
    }
    if (fromStatus === 'unlocked' && toStatus === 'unlocked') return EDGE_COLORS.active;
    return EDGE_COLORS.inactive;
  };

  const isEdgeHighlighted = (edge: SkillEdge) => highlightedEdges.has(`${edge.from}-${edge.to}`);

  /** 渲染一條邊（二次貝茲曲線） */
  const renderEdge = (edge: SkillEdge, i: number) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) return null;

    const color = getEdgeColor(edge);
    const highlighted = isEdgeHighlighted(edge);
    const isCombo = edge.type === 'combo';

    /* 用垂直偏移產生弧度 */
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

  /** 渲染節點 — 依類型繪製不同形狀 */
  const renderNode = (node: SkillNode) => {
    const effectiveNodeStatus = getEffectiveStatus(node.id);
    const color = NODE_COLORS[effectiveNodeStatus];
    const dimmedByHover = hoveredNode && !highlightedNodes.has(node.id) && hoveredNode !== node.id;
    const dimmedBySearch = searchMatches && !searchMatches.has(node.id);
    const baseOpacity = dimmedByHover ? 0.2 : dimmedBySearch ? 0.15 : 1;

    const isHovered = hoveredNode === node.id;
    const isSelected = selectedNode?.id === node.id;

    /* Source 節點（App）— 正方形 */
    if (node.type === 'source') {
      const size = 32;
      const isConnected = connectedApps.has(node.id);
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
      const isActive = effectiveNodeStatus !== 'locked';
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

    /* Skill 節點 — 圓形 */
    const r = 20;
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
            isHovered && effectiveNodeStatus === 'unlocked'
              ? { filter: 'drop-shadow(0 0 8px rgba(29,158,117,0.5))' }
              : isHovered && effectiveNodeStatus === 'pending'
              ? { filter: 'drop-shadow(0 0 8px rgba(212,168,67,0.4))' }
              : {}
          }
        />
        <circle
          cx={node.x} cy={node.y} r={5}
          fill={color}
          opacity={effectiveNodeStatus === 'locked' ? 0.3 : 0.8}
        />
        <text
          x={node.x} y={node.y + r + 14}
          textAnchor="middle" dominantBaseline="middle"
          fill={effectiveNodeStatus === 'locked' ? '#94A3B8' : '#1E293B'}
          fontSize={9} fontWeight={500}
          fontFamily="JetBrains Mono, monospace"
        >
          {node.label}
        </text>
      </g>
    );
  };

  /* 進度統計 */
  const skillNodes = nodes.filter(n => n.type !== 'source');
  const unlockedNodes = skillNodes.filter(n => getEffectiveStatus(n.id) === 'unlocked').length;

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background select-none">
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
            {/* 點狀背景 */}
            <rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#dotGrid)" />
            {/* 邊 */}
            {edges.map((e, i) => renderEdge(e, i))}
            {/* 節點 */}
            {nodes.map(renderNode)}
          </g>
        </svg>
      </div>

      {/* UI 覆蓋層 */}
      <SearchBar nodes={nodes} onSearch={setSearchQuery} onSelectNode={handleSearchSelect} />
      <ProgressBar unlocked={unlockedNodes} total={skillNodes.length} />
      <Legend />

      {/* 詳情面板 */}
      {selectedNode && (
        <DetailPanel
          node={selectedNode}
          allNodes={nodes}
          effectiveStatus={getEffectiveStatus}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {/* OAuth 連接對話框 */}
      {oauthTarget && (
        <OAuthDialog
          appLabel={oauthTarget.label}
          isConnected={connectedApps.has(oauthTarget.id)}
          open={!!oauthTarget}
          onOpenChange={(open) => { if (!open) setOauthTarget(null); }}
          onConfirm={handleOAuthConfirm}
        />
      )}
    </div>
  );
}
