"use client";

/**
 * 技能樹主畫布 — 三圈同心圓佈局
 * 外圈 App（方形 44px）→ 中圈 action（圓點 8px）→ 內圈組合技（菱形 28px）
 * 組合技連線只在 hover 組合技時才顯示
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { buildSkillTree, SkillNode, SkillEdge, SkillsApiApp, SkillsApiCombo, SkillsApiDiscovered } from '@/data/skillTreeData';
import { DetailPanel } from './DetailPanel';
import { ProgressBar } from './ProgressBar';
import { Legend } from './Legend';
import { SearchBar } from './SearchBar';
import { ConnectDialog } from './ConnectDialog';

const TEAL = '#1D9E75';
const GOLD = '#D4A843';
const GRAY = '#CBD5E1';
const GRAY_LIGHT = '#E2E8F0';

export function SkillTreeCanvas() {
  /* ── API 資料 ── */
  const [apps, setApps] = useState<SkillsApiApp[]>([]);
  const [combos, setCombos] = useState<SkillsApiCombo[]>([]);
  const [discovered, setDiscovered] = useState<SkillsApiDiscovered[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── 互動狀態 ── */
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.55);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<SkillNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [connectTarget, setConnectTarget] = useState<SkillNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  /* ── 健康狀態資料 ── */
  interface AppHealth {
    appName: string;
    status: 'green' | 'yellow' | 'red';
    successRate: number;
    totalCalls: number;
    failedCalls: number;
    avgDurationMs: number;
  }
  const [healthData, setHealthData] = useState<Map<string, AppHealth>>(new Map());

  /* ── 刷新資料 ── */
  const refreshData = useCallback(async () => {
    try {
      const [skillsRes, healthRes] = await Promise.all([
        fetch('/api/skills'),
        fetch('/api/skills/health').catch(() => null),
      ]);
      if (skillsRes.ok) {
        const data = await skillsRes.json();
        setApps(data.apps);
        setCombos(data.combos ?? []);
        setDiscovered(data.discovered ?? []);
      }
      if (healthRes?.ok) {
        const hData = await healthRes.json();
        const map = new Map<string, AppHealth>();
        (hData.health ?? []).forEach((h: AppHealth) => map.set(h.appName, h));
        setHealthData(map);
      }
    } catch { /* 靜默 */ }
  }, []);

  useEffect(() => {
    const handleFocus = () => { refreshData(); };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshData();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshData]);

  useEffect(() => {
    Promise.all([
      fetch('/api/skills').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      fetch('/api/skills/health').then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([skillsData, healthRaw]) => {
        setApps(skillsData.apps);
        setCombos(skillsData.combos ?? []);
        setDiscovered(skillsData.discovered ?? []);
        if (healthRaw?.health) {
          const map = new Map<string, AppHealth>();
          healthRaw.health.forEach((h: AppHealth) => map.set(h.appName, h));
          setHealthData(map);
        }
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  /* ── 建構節點 ── */
  const { nodes, edges } = useMemo(() => {
    if (apps.length === 0) return { nodes: [], edges: [] };
    return buildSkillTree(apps, combos, discovered);
  }, [apps, combos, discovered]);

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const connectedApps = useMemo(() => new Set(apps.filter(a => a.connected).map(a => a.name)), [apps]);

  const hoveredNodeData = useMemo(() => {
    if (!hoveredNode) return null;
    return nodeMap.get(hoveredNode) ?? null;
  }, [hoveredNode, nodeMap]);

  /* 判斷 hover 的是否為 combo 節點 */
  const hoveredIsCombo = hoveredNodeData?.type === 'combo';

  /* ── 預覽亮起：hover 未連接 App 時，其 cluster 暫時亮起 ── */
  const previewApp = useMemo(() => {
    if (!hoveredNodeData) return null;
    /* hover 未連接的 App → 預覽亮起 */
    if (hoveredNodeData.type === 'source' && hoveredNodeData.status === 'locked') {
      return hoveredNodeData.id;
    }
    /* hover 未連接 App 的 action → 預覽亮起該 App */
    if (hoveredNodeData.type === 'skill' && hoveredNodeData.app && !connectedApps.has(hoveredNodeData.app)) {
      return hoveredNodeData.app;
    }
    return null;
  }, [hoveredNodeData, connectedApps]);

  /* ── 推薦下一個該連的 App（解鎖最多組合技的） ── */
  const recommendation = useMemo(() => {
    if (combos.length === 0 || apps.length === 0) return null;
    const unconnected = apps.filter(a => !a.connected);
    if (unconnected.length === 0) return null;

    let bestApp: SkillsApiApp | null = null;
    let bestScore = 0;
    let bestReason = '';

    for (const app of unconnected) {
      /* 計算：如果連上這個 App，能額外解鎖幾個組合技 */
      const hypothetical = new Set([...connectedApps, app.name]);
      let newUnlocks = 0;
      const unlockNames: string[] = [];

      for (const combo of combos) {
        if (combo.unlocked) continue; // 已解鎖的不算
        const requiredApps = [...new Set(combo.prerequisites.map(p => p.app))];
        const wouldUnlock = requiredApps.every(a => hypothetical.has(a));
        if (wouldUnlock) {
          newUnlocks++;
          unlockNames.push(combo.name.zh);
        }
      }

      /* 分數 = 能解鎖的組合技數 + action 數 * 0.01（同分時 action 多的優先） */
      const score = newUnlocks + app.actions.length * 0.01;
      if (score > bestScore) {
        bestScore = score;
        bestApp = app;
        bestReason = newUnlocks > 0
          ? `可解鎖 ${newUnlocks} 個組合技：${unlockNames.slice(0, 2).join('、')}${unlockNames.length > 2 ? '…' : ''}`
          : `新增 ${app.actions.length} 個技能`;
      }
    }

    if (!bestApp) return null;
    const label = bestApp.displayName.zh || bestApp.displayName.en || bestApp.name;
    return { appName: label, appId: bestApp.name, reason: bestReason };
  }, [apps, combos, connectedApps]);

  /* ── 搜尋 ── */
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return new Set(nodes.filter(n =>
      n.label.toLowerCase().includes(q) ||
      n.description.toLowerCase().includes(q) ||
      (n.descriptionEn && n.descriptionEn.toLowerCase().includes(q)) ||
      (n.app && n.app.toLowerCase().includes(q))
    ).map(n => n.id));
  }, [searchQuery, nodes]);

  /* ── hover 高亮計算 ── */
  const { highlightedEdges, highlightedNodes } = useMemo(() => {
    if (!hoveredNode) return { highlightedEdges: new Set<string>(), highlightedNodes: new Set<string>() };

    const hEdges = new Set<string>();
    const hNodes = new Set<string>();
    hNodes.add(hoveredNode);

    const hoveredData = nodeMap.get(hoveredNode);

    if (hoveredData?.type === 'combo') {
      /* hover 組合技：高亮前置 action + 它們所屬的 App */
      edges.filter(e => e.type === 'combo' && e.to === hoveredNode).forEach(e => {
        hEdges.add(`${e.from}-${e.to}`);
        hNodes.add(e.from); // action 節點
        /* 找到 action 所屬的 App 並高亮 */
        const actionNode = nodeMap.get(e.from);
        if (actionNode?.app) hNodes.add(actionNode.app);
      });
    } else {
      /* hover App 或 action：高亮直接連線的節點 */
      edges.filter(e => e.from === hoveredNode || e.to === hoveredNode).forEach(e => {
        if (e.type === 'combo') return; // 非 combo hover 不高亮 combo 邊
        hEdges.add(`${e.from}-${e.to}`);
        hNodes.add(e.from);
        hNodes.add(e.to);
      });
    }

    return { highlightedEdges: hEdges, highlightedNodes: hNodes };
  }, [hoveredNode, edges, nodeMap]);

  /* ── 互動 handlers ── */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(3, Math.max(0.2, z * (e.deltaY > 0 ? 0.9 : 1.1))));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) { setDragging(true); setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y }); }
  }, [pan]);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging) setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    setTooltipPos({ x: e.clientX, y: e.clientY });
  }, [dragging, dragStart]);
  const handleMouseUp = useCallback(() => setDragging(false), []);

  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) { const t = e.touches[0]; touchRef.current = { x: t.clientX - pan.x, y: t.clientY - pan.y }; }
  }, [pan]);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1 && touchRef.current) { const t = e.touches[0]; setPan({ x: t.clientX - touchRef.current.x, y: t.clientY - touchRef.current.y }); }
  }, []);

  const handleNodeClick = useCallback((e: React.MouseEvent, node: SkillNode) => {
    e.stopPropagation();
    if (node.type === 'source') setConnectTarget(node);
    else setSelectedNode(node);
  }, []);

  /* 點擊空白處關閉側邊欄 */
  const handleCanvasClick = useCallback(() => { setSelectedNode(null); }, []);

  const handleConnect = useCallback(async (appName: string, authType: string) => {
    try {
      const sessionRes = await fetch('/api/auth/session');
      const session = await sessionRes.json();
      if (!session?.user) { window.location.href = '/api/auth/signin?callbackUrl=/skill-tree'; return; }
    } catch { window.location.href = '/api/auth/signin?callbackUrl=/skill-tree'; return; }
    if (authType === 'oauth2') window.open(`/api/connect/${appName}?from=skill-tree`, '_blank');
  }, []);

  const handleDisconnect = useCallback(async (appName: string) => {
    await fetch(`/api/connect/${appName}`, { method: 'DELETE' });
    await refreshData();
    setConnectTarget(null);
  }, [refreshData]);

  const handleSearchSelect = useCallback((node: SkillNode) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setPan({ x: rect.width / 2 - node.x, y: rect.height / 2 - node.y });
    setZoom(1);
    setSearchQuery('');
  }, []);

  /* ── 渲染邊 ── */
  const renderEdge = (edge: SkillEdge, i: number) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) return null;

    const isCombo = edge.type === 'combo';
    const edgeKey = `${edge.from}-${edge.to}`;
    const highlighted = highlightedEdges.has(edgeKey);
    const isActive = from.status === 'unlocked' && to.status === 'unlocked';
    /* 是否在預覽中（hover 未連接 App 時，其 cluster 的邊也亮起） */
    const isPreviewing = previewApp && (from.app === previewApp || from.id === previewApp || to.app === previewApp);

    let stroke: string;
    let opacity: number;

    if (isCombo) {
      /* 組合技虛線永遠可見 */
      stroke = isActive ? GOLD : GRAY;
      if (hoveredNode) {
        opacity = highlighted ? 0.8 : 0.1;
      } else {
        opacity = isActive ? 0.6 : 0.2;
      }
      if (highlighted) stroke = GOLD;
    } else {
      /* App → action 細線 */
      // U20: 區分已使用/未使用的 action 連線色彩
      const edgeLit = isActive || isPreviewing;
      const targetUsed = to.used === true;
      stroke = edgeLit
        ? (targetUsed ? TEAL : '#A7D8C8') // U20: 已用深綠, 未用淡綠
        : GRAY_LIGHT;
      if (highlighted) stroke = TEAL;
      opacity = hoveredNode
        ? (highlighted ? 0.8 : isPreviewing ? 0.3 : 0.05)
        : (isActive ? (targetUsed ? 0.4 : 0.15) : 0.08); // U20: 已用較深
    }

    return (
      <line
        key={`edge-${i}`}
        x1={from.x} y1={from.y} x2={to.x} y2={to.y}
        stroke={stroke}
        strokeWidth={isCombo ? 1.5 : 1}
        strokeDasharray={isCombo ? '6 4' : 'none'}
        opacity={opacity}
        style={{ transition: 'opacity 300ms' }}
      />
    );
  };

  /* ── 渲染節點 ── */
  const renderNode = (node: SkillNode) => {
    const isHovered = hoveredNode === node.id;
    const isSelected = selectedNode?.id === node.id;
    const isConnected = node.status === 'unlocked';
    const dimmedBySearch = searchMatches && !searchMatches.has(node.id);
    const dimmedByHover = hoveredNode && !highlightedNodes.has(node.id) && hoveredNode !== node.id;

    /* ── App（外圈）── */
    if (node.type === 'source') {
      const size = 44;
      const r = 8;
      const isPreviewing = previewApp === node.id; // hover 未連接 App 時預覽亮起
      const showLit = isConnected || isPreviewing;  // 連接或預覽中都顯示亮起
      const opacity = dimmedBySearch ? 0.15 : dimmedByHover ? 0.2 : 1;

      return (
        <g key={node.id} opacity={opacity} style={{ cursor: 'pointer', transition: 'opacity 300ms' }}
          onClick={(e) => handleNodeClick(e, node)}
          onMouseEnter={() => setHoveredNode(node.id)}
          onMouseLeave={() => setHoveredNode(null)}
        >
          {/* 光暈：已連接 = teal，預覽 = teal 半透明脈動 */}
          {showLit && (
            <rect x={node.x - size - 4} y={node.y - size - 4}
              width={(size + 4) * 2} height={(size + 4) * 2}
              rx={r + 4} ry={r + 4}
              fill="none" stroke={TEAL} strokeWidth={isPreviewing ? 1.5 : 1}
              opacity={isPreviewing ? 0.4 : 0.2}
              style={{ filter: `blur(${isPreviewing ? 6 : 4}px)`, transition: 'opacity 300ms' }}
            />
          )}
          <rect x={node.x - size} y={node.y - size}
            width={size * 2} height={size * 2} rx={r} ry={r}
            fill={showLit ? '#F0FDF9' : '#FAFAFA'}
            stroke={showLit ? TEAL : '#D1D5DB'}
            strokeWidth={isHovered || isSelected ? 2.5 : 1.5}
            style={{ transition: 'fill 300ms, stroke 300ms' }}
          />
          <text x={node.x} y={node.y - 6} textAnchor="middle" dominantBaseline="middle"
            fill={showLit ? '#0F4F3E' : '#9CA3AF'} fontSize={12} fontWeight={600}
            fontFamily="Inter, sans-serif"
          >
            {node.label}
          </text>
          <text x={node.x} y={node.y + 12} textAnchor="middle" dominantBaseline="middle"
            fill={showLit ? '#6B7280' : '#D1D5DB'} fontSize={9}
            fontFamily="JetBrains Mono, monospace"
          >
            · {node.actionCount ?? 0} actions
          </text>
          <text x={node.x} y={node.y + size + 14} textAnchor="middle" dominantBaseline="middle"
            fill={showLit ? TEAL : '#9CA3AF'} fontSize={8} fontWeight={500}
            fontFamily="JetBrains Mono, monospace"
          >
            {isConnected ? '已連接' : isPreviewing ? '點擊解鎖' : '點擊連接'}
          </text>
          {/* 健康燈號：已連接且有使用紀錄才顯示 */}
          {isConnected && (() => {
            const h = healthData.get(node.id);
            if (!h || h.totalCalls === 0) return null;
            const color = h.status === 'green' ? '#22C55E' : h.status === 'yellow' ? '#EAB308' : '#EF4444';
            return (
              <g>
                <circle cx={node.x + size - 6} cy={node.y - size + 6} r={5}
                  fill={color} stroke="#FFFFFF" strokeWidth={1.5} />
                {/* hover App 時在燈號旁顯示成功率 */}
                {isHovered && (
                  <text x={node.x + size + 6} y={node.y - size + 10}
                    fontSize={8} fill={color} fontFamily="JetBrains Mono, monospace"
                  >
                    {h.successRate}% · {h.avgDurationMs}ms
                  </text>
                )}
              </g>
            );
          })()}
        </g>
      );
    }

    /* ── 組合技（內圈）── */
    if (node.type === 'combo') {
      const size = 28;
      const isActive = isConnected;
      const isDisc = !!node.discovered;
      const opacity = dimmedBySearch ? 0.15 : dimmedByHover ? 0.2 : 1;

      /* 自動發現的用圓形 + 紫色，策展的用菱形 + 金色 */
      const accentColor = isDisc ? '#8B5CF6' : GOLD;
      const fillActive = isDisc ? '#F5F3FF' : '#FFFDF5';

      if (isDisc) {
        /* 自動發現：虛線圓形 */
        return (
          <g key={node.id} opacity={opacity} style={{ cursor: 'pointer', transition: 'opacity 300ms' }}
            onClick={(e) => handleNodeClick(e, node)}
            onMouseEnter={() => setHoveredNode(node.id)}
            onMouseLeave={() => setHoveredNode(null)}
          >
            {isActive && (
              <circle cx={node.x} cy={node.y} r={size + 3}
                fill="none" stroke={accentColor} strokeWidth={1} opacity={0.3}
                style={{ filter: 'blur(3px)' }}
              />
            )}
            <circle cx={node.x} cy={node.y} r={size}
              fill={isActive ? fillActive : '#FAFAFA'}
              stroke={isActive ? accentColor : GRAY}
              strokeWidth={isHovered || isSelected ? 2.5 : 1.5}
              strokeDasharray="5 3"
            />
            {/* 頻率徽章 */}
            <text x={node.x} y={node.y - 2} textAnchor="middle" dominantBaseline="middle"
              fill={isActive ? accentColor : '#9CA3AF'} fontSize={10} fontWeight={600}
              fontFamily="JetBrains Mono, monospace"
            >
              {node.frequency ?? '?'}×
            </text>
            <text x={node.x} y={node.y + size + 16} textAnchor="middle" dominantBaseline="middle"
              fill={isActive ? accentColor : '#9CA3AF'} fontSize={8} fontWeight={500}
              fontFamily="JetBrains Mono, monospace"
            >
              {node.label}
            </text>
            <text x={node.x} y={node.y + size + 28} textAnchor="middle" dominantBaseline="middle"
              fill="#9CA3AF" fontSize={7}
              fontFamily="JetBrains Mono, monospace"
            >
              自動發現
            </text>
          </g>
        );
      }

      /* 策展組合技：菱形 */
      const pts = `${node.x},${node.y - size} ${node.x + size},${node.y} ${node.x},${node.y + size} ${node.x - size},${node.y}`;
      return (
        <g key={node.id} opacity={opacity} style={{ cursor: 'pointer', transition: 'opacity 300ms' }}
          onClick={(e) => handleNodeClick(e, node)}
          onMouseEnter={() => setHoveredNode(node.id)}
          onMouseLeave={() => setHoveredNode(null)}
        >
          {isActive && (
            <polygon
              points={`${node.x},${node.y - size - 3} ${node.x + size + 3},${node.y} ${node.x},${node.y + size + 3} ${node.x - size - 3},${node.y}`}
              fill="none" stroke={accentColor} strokeWidth={1} opacity={0.3}
              style={{ filter: 'blur(3px)' }}
            />
          )}
          <polygon points={pts}
            fill={isActive ? fillActive : '#FAFAFA'}
            stroke={isActive ? accentColor : GRAY}
            strokeWidth={isHovered || isSelected ? 2.5 : 1.5}
            strokeDasharray="5 3"
          />
          <text x={node.x} y={node.y + size + 16} textAnchor="middle" dominantBaseline="middle"
            fill={isActive ? accentColor : '#9CA3AF'} fontSize={9} fontWeight={500}
            fontFamily="JetBrains Mono, monospace"
          >
            {node.label}
          </text>
        </g>
      );
    }

    /* ── Action（中圈）── 小圓點 */
    // U17: 區分已使用（實心深色）和未使用（淡色）的 action
    // U20: 連線顏色跟節點狀態同步
    const dotR = isHovered ? 10 : 8;
    const clusterConnected = node.app ? connectedApps.has(node.app) : false;
    const clusterPreviewing = node.app ? previewApp === node.app : false;
    const showActionLit = clusterConnected || clusterPreviewing; // 連接或預覽中
    const actionUsed = node.used === true; // U17: 是否曾使用過
    // U17: 已使用 = 實心深色，未使用 = 淡色（同 App 已連接時）
    const actionColor = showActionLit
      ? (actionUsed ? TEAL : '#A7D8C8') // 已用:深綠, 未用:淡綠
      : GRAY;
    const actionOpacity = showActionLit
      ? (actionUsed ? 0.9 : (clusterPreviewing ? 0.4 : 0.5))
      : 0.5;
    const baseOpacity = showActionLit ? 1 : 0.3;
    const finalOpacity = dimmedBySearch ? 0.08 : dimmedByHover ? 0.1 : baseOpacity;

    return (
      <g key={node.id} opacity={finalOpacity} style={{ cursor: 'pointer', transition: 'opacity 300ms' }}
        onClick={(e) => handleNodeClick(e, node)}
        onMouseEnter={() => setHoveredNode(node.id)}
        onMouseLeave={() => setHoveredNode(null)}
      >
        <circle cx={node.x} cy={node.y} r={dotR}
          fill={actionColor}
          opacity={actionOpacity}
          style={{ transition: 'r 150ms, fill 300ms, opacity 300ms' }}
        />
        {isHovered && (
          <circle cx={node.x} cy={node.y} r={dotR + 4}
            fill="none" stroke={actionColor}
            strokeWidth={1.5} opacity={0.5}
          />
        )}
      </g>
    );
  };

  /* ── 進度 ── */
  const connectedCount = connectedApps.size;
  const totalApps = apps.length;

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

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-screen bg-white">
        <div className="text-center space-y-3 max-w-md px-4">
          <p className="text-red-500 font-semibold">載入失敗</p>
          <p className="text-gray-400 text-sm">{error}</p>
          <button onClick={() => { setError(null); setLoading(true); window.location.reload(); }}
            className="px-4 py-2 bg-black text-white text-sm rounded-md hover:bg-gray-800">重試</button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-white select-none">
      <div
        ref={containerRef} className="w-full h-full"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setDragging(false); setHoveredNode(null); }}
        onTouchStart={handleTouchStart} onTouchMove={handleTouchMove}
        onTouchEnd={() => { touchRef.current = null; }}
        onClick={handleCanvasClick}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
          <defs>
            <pattern id="dotGrid" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="12" cy="12" r="1" fill="#E5E7EB" />
            </pattern>
          </defs>
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            <rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#dotGrid)" />
            {edges.map((e, i) => renderEdge(e, i))}
            {nodes.filter(n => n.type === 'skill').map(renderNode)}
            {nodes.filter(n => n.type === 'combo').map(renderNode)}
            {nodes.filter(n => n.type === 'source').map(renderNode)}
          </g>
        </svg>
      </div>

      {/* Tooltip — hover action 或 combo 時顯示 */}
      {hoveredNodeData && (hoveredNodeData.type === 'skill' || hoveredNodeData.type === 'combo') && tooltipPos && (
        <div className="fixed z-50 pointer-events-none px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg max-w-xs"
          style={{ left: tooltipPos.x + 16, top: tooltipPos.y - 8 }}
        >
          <div className="font-semibold font-mono mb-0.5">{hoveredNodeData.label}</div>
          <div className="text-gray-300 leading-snug">{hoveredNodeData.description}</div>
          {hoveredNodeData.descriptionEn && (
            <div className="text-gray-500 leading-snug mt-0.5 text-[10px]">{hoveredNodeData.descriptionEn}</div>
          )}
          {hoveredNodeData.app && (
            <div className="text-gray-500 text-[10px] mt-1 font-mono">{hoveredNodeData.app}</div>
          )}
          {/* combo hover 顯示前置條件摘要 */}
          {hoveredIsCombo && hoveredNodeData.prerequisites && (
            <div className="text-gray-400 text-[10px] mt-1 border-t border-gray-700 pt-1">
              需要：{hoveredNodeData.prerequisites.map(p => p.label).join('、')}
            </div>
          )}
        </div>
      )}

      <SearchBar nodes={nodes} onSearch={setSearchQuery} onSelectNode={handleSearchSelect} />
      <ProgressBar
        unlocked={connectedCount}
        total={totalApps}
        recommendation={recommendation ? { appName: recommendation.appName, reason: recommendation.reason } : null}
        onRecommendationClick={(name) => {
          /* 找到對應的 App 節點並平移到它 */
          const appNode = nodes.find(n => n.type === 'source' && n.label === name);
          if (appNode) {
            const container = containerRef.current;
            if (container) {
              const rect = container.getBoundingClientRect();
              setPan({ x: rect.width / 2 - appNode.x, y: rect.height / 2 - appNode.y });
              setZoom(1);
            }
            setHoveredNode(appNode.id);
          }
        }}
      />
      <Legend />

      {selectedNode && (
        <DetailPanel node={selectedNode} allNodes={nodes} connectedApps={connectedApps}
          onClose={() => setSelectedNode(null)} />
      )}

      {connectTarget && (
        <ConnectDialog node={connectTarget} isConnected={connectedApps.has(connectTarget.id)}
          open={!!connectTarget} onOpenChange={(open) => { if (!open) setConnectTarget(null); }}
          onConnect={handleConnect} onDisconnect={handleDisconnect} />
      )}
    </div>
  );
}
