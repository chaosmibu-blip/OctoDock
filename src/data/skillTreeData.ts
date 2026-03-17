/**
 * 技能樹資料定義 — 類型 + 力導向佈局演算法
 * 佈局：組合技在中央，App 在外圈，action 在中間
 * 視覺動線：外圈 App → 中間 action → 中央組合技
 */

export type NodeStatus = 'unlocked' | 'locked';
export type NodeType = 'source' | 'skill' | 'combo';

/** 技能樹節點 */
export interface SkillNode {
  id: string;
  label: string;
  type: NodeType;
  status: NodeStatus;
  x: number;
  y: number;
  description: string;        // 主要描述（中文優先）
  descriptionEn?: string;     // 英文描述（skill 節點）
  app?: string;
  authType?: string;
  actionCount?: number;       // source 節點的 action 數量
  prerequisites?: Array<{ nodeId: string; label: string; app: string }>; // combo 的前置 action 節點
}

/** 技能樹邊 */
export interface SkillEdge {
  from: string;
  to: string;
  type: 'normal' | 'combo';
}

/** API /api/skills 回傳的 App 資料 */
export interface SkillsApiApp {
  name: string;
  displayName: Record<string, string>;
  authType: string;
  connected: boolean;
  connectedAt: string | null;
  actions: Array<{ name: string; description: { zh: string; en: string } }>;
}

/** API /api/skills 回傳的組合技資料 */
export interface SkillsApiCombo {
  id: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  prerequisites: Array<{ app: string; action: string }>;
  unlocked: boolean;
}

/* ── 佈局常數 ── */

const BASE_RADIUS = 60;
const RADIUS_PER_ACTION = 8;

/* 力導向參數 */
const SIM_ITERATIONS = 150;
const REPULSION = 90000;
const AFFINITY_STRENGTH = 0.05;
const CANVAS_CENTER = { x: 900, y: 700 };
const CENTER_PULL = 0.001;
const OUTWARD_PUSH = 0.04;    // 把 App 往外推的力
const MIN_CENTER_DIST = 350;  // App 離中心的最小距離（留空給組合技）

/* ── 力導向佈局（App 往外推） ── */

function forceDirectedLayout(
  apps: SkillsApiApp[],
): Map<string, { x: number; y: number; radius: number }> {
  const n = apps.length;
  if (n === 0) return new Map();

  const radii = apps.map(a => BASE_RADIUS + a.actions.length * RADIUS_PER_ACTION);

  const getProvider = (app: SkillsApiApp): string => {
    if (app.name.startsWith('google_') || app.name === 'gmail' || app.name === 'youtube') return 'google';
    return app.name;
  };

  /* 初始位置：沿大圓分佈在外圈 */
  const initRadius = 500 + n * 25;
  const positions = apps.map((_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return {
      x: CANVAS_CENTER.x + Math.cos(angle) * initRadius,
      y: CANVAS_CENTER.y + Math.sin(angle) * initRadius,
      vx: 0,
      vy: 0,
    };
  });

  for (let iter = 0; iter < SIM_ITERATIONS; iter++) {
    const cooling = 1 - iter / SIM_ITERATIONS;

    for (let i = 0; i < n; i++) {
      let fx = 0, fy = 0;

      /* 斥力 */
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const minDist = radii[i] + radii[j] + 80;
        const force = REPULSION / (dist * dist);
        const overlap = dist < minDist ? (minDist - dist) * 2 : 0;
        fx += (dx / dist) * (force + overlap);
        fy += (dy / dist) * (force + overlap);
      }

      /* 同 provider 吸引力 */
      const providerI = getProvider(apps[i]);
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (getProvider(apps[j]) === providerI) {
          const dx = positions[j].x - positions[i].x;
          const dy = positions[j].y - positions[i].y;
          fx += dx * AFFINITY_STRENGTH;
          fy += dy * AFFINITY_STRENGTH;
        }
      }

      /* 微弱中心引力（防止飄太遠） */
      fx += (CANVAS_CENTER.x - positions[i].x) * CENTER_PULL;
      fy += (CANVAS_CENTER.y - positions[i].y) * CENTER_PULL;

      /* 向外推的力：離中心越近推力越大，保持中央留白給組合技 */
      const dxCenter = positions[i].x - CANVAS_CENTER.x;
      const dyCenter = positions[i].y - CANVAS_CENTER.y;
      const distCenter = Math.max(Math.sqrt(dxCenter * dxCenter + dyCenter * dyCenter), 1);
      if (distCenter < MIN_CENTER_DIST) {
        const pushStrength = (MIN_CENTER_DIST - distCenter) * OUTWARD_PUSH;
        fx += (dxCenter / distCenter) * pushStrength;
        fy += (dyCenter / distCenter) * pushStrength;
      }

      positions[i].vx = (positions[i].vx + fx) * cooling * 0.5;
      positions[i].vy = (positions[i].vy + fy) * cooling * 0.5;
    }

    for (let i = 0; i < n; i++) {
      positions[i].x += positions[i].vx;
      positions[i].y += positions[i].vy;
    }
  }

  const result = new Map<string, { x: number; y: number; radius: number }>();
  apps.forEach((app, i) => {
    result.set(app.name, {
      x: Math.round(positions[i].x),
      y: Math.round(positions[i].y),
      radius: radii[i],
    });
  });
  return result;
}

/* ── action 群聚佈局（黃金角螺旋） ── */

function placeActions(
  cx: number,
  cy: number,
  count: number,
  clusterRadius: number,
): Array<{ x: number; y: number }> {
  if (count === 0) return [];

  const positions: Array<{ x: number; y: number }> = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const innerR = clusterRadius * 0.35;
  const outerR = clusterRadius * 0.85;

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const r = innerR + (outerR - innerR) * Math.sqrt(t);
    const angle = i * goldenAngle;
    positions.push({
      x: Math.round(cx + Math.cos(angle) * r),
      y: Math.round(cy + Math.sin(angle) * r),
    });
  }
  return positions;
}

/* ── 主要建構函式 ── */

export function buildSkillTree(
  apps: SkillsApiApp[],
  combos: SkillsApiCombo[],
): {
  nodes: SkillNode[];
  edges: SkillEdge[];
} {
  const nodes: SkillNode[] = [];
  const edges: SkillEdge[] = [];

  /* 1. 力導向計算 App 位置（外圈） */
  const layout = forceDirectedLayout(apps);

  /* 已連接 App Set */
  const connectedSet = new Set(apps.filter(a => a.connected).map(a => a.name));

  /* 2. 建立 App cluster */
  apps.forEach((app) => {
    const pos = layout.get(app.name);
    if (!pos) return;
    const { x: cx, y: cy, radius } = pos;
    const label = app.displayName.zh || app.displayName.en || app.name;

    nodes.push({
      id: app.name,
      label,
      type: 'source',
      status: app.connected ? 'unlocked' : 'locked',
      x: cx,
      y: cy,
      description: `${label} 整合`,
      app: app.name,
      authType: app.authType,
      actionCount: app.actions.length,
    });

    const actionPositions = placeActions(cx, cy, app.actions.length, radius);
    app.actions.forEach((action, i) => {
      const actionId = `${app.name}--${action.name}`;
      nodes.push({
        id: actionId,
        label: action.description.zh || action.name,
        type: 'skill',
        status: app.connected ? 'unlocked' : 'locked',
        x: actionPositions[i].x,
        y: actionPositions[i].y,
        description: action.description.zh,
        descriptionEn: action.description.en,
        app: app.name,
      });
      edges.push({ from: app.name, to: actionId, type: 'normal' });
    });
  });

  /* 3. 組合技節點 — 放在中央區域 */
  if (combos.length > 0) {
    /* 用小型力導向讓組合技在中央區域散開，不重疊 */
    const comboPositions = combos.map((_, i) => {
      const angle = (i / combos.length) * Math.PI * 2 - Math.PI / 2;
      const r = 60 + combos.length * 12;
      return {
        x: CANVAS_CENTER.x + Math.cos(angle) * r,
        y: CANVAS_CENTER.y + Math.sin(angle) * r,
        vx: 0, vy: 0,
      };
    });

    /* 排斥迭代 */
    for (let iter = 0; iter < 50; iter++) {
      for (let i = 0; i < combos.length; i++) {
        let fx = 0, fy = 0;
        for (let j = 0; j < combos.length; j++) {
          if (i === j) continue;
          const dx = comboPositions[i].x - comboPositions[j].x;
          const dy = comboPositions[i].y - comboPositions[j].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          if (dist < 130) {
            const push = (130 - dist);
            fx += (dx / dist) * push * 0.3;
            fy += (dy / dist) * push * 0.3;
          }
        }
        /* 微弱中心引力 */
        fx += (CANVAS_CENTER.x - comboPositions[i].x) * 0.01;
        fy += (CANVAS_CENTER.y - comboPositions[i].y) * 0.01;

        comboPositions[i].x += fx;
        comboPositions[i].y += fy;
      }
    }

    combos.forEach((combo, ci) => {
      /* 前置 action 節點 ID 列表 */
      const prereqNodes = combo.prerequisites.map(p => ({
        nodeId: `${p.app}--${p.action}`,
        label: nodes.find(n => n.id === `${p.app}--${p.action}`)?.label ?? p.action,
        app: p.app,
      }));

      /* 所有前置 App 都已連接 → unlocked */
      const requiredApps = [...new Set(combo.prerequisites.map(p => p.app))];
      const isUnlocked = requiredApps.every(a => connectedSet.has(a));

      nodes.push({
        id: combo.id,
        label: combo.name.zh,
        type: 'combo',
        status: isUnlocked ? 'unlocked' : 'locked',
        x: Math.round(comboPositions[ci].x),
        y: Math.round(comboPositions[ci].y),
        description: combo.description.zh,
        descriptionEn: combo.description.en,
        prerequisites: prereqNodes,
      });

      /* 邊：連到具體 action 節點 */
      combo.prerequisites.forEach(p => {
        const actionNodeId = `${p.app}--${p.action}`;
        edges.push({ from: actionNodeId, to: combo.id, type: 'combo' });
      });
    });
  }

  return { nodes, edges };
}
