/**
 * 技能樹資料定義 — 類型 + 力導向佈局演算法
 * 節點和邊由 buildSkillTree() 根據 API 回傳動態產生
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
  description: string;
  app?: string;
  authType?: string;
  actionCount?: number;       // source 節點的 action 數量（顯示用）
  prerequisites?: string[];   // combo 節點的前置 App 名稱
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
  actions: Array<{ name: string; description: string }>;
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

/** cluster 半徑 = 基礎半徑 + action 數 × 係數 */
const BASE_RADIUS = 60;
const RADIUS_PER_ACTION = 8;

/** 力導向模擬參數 */
const SIM_ITERATIONS = 120;
const REPULSION = 80000;       // App 之間的斥力
const AFFINITY_STRENGTH = 0.06; // 同 OAuth provider 吸引力
const CANVAS_CENTER = { x: 900, y: 700 };
const CENTER_PULL = 0.002;     // 向中心的微弱拉力，防止飄太遠

/* ── 力導向佈局 ── */

/**
 * 簡易力導向演算法：計算 App 節點的位置
 * - 所有 App 互相排斥（避免重疊）
 * - 同 OAuth provider 的 App 互相吸引（形成群落）
 * - 微弱的中心引力（防止飄散）
 */
function forceDirectedLayout(
  apps: SkillsApiApp[],
): Map<string, { x: number; y: number; radius: number }> {
  const n = apps.length;
  if (n === 0) return new Map();

  /* 計算每個 App 的 cluster 半徑 */
  const radii = apps.map(a => BASE_RADIUS + a.actions.length * RADIUS_PER_ACTION);

  /* 判斷 OAuth provider 分組：同 authType + 名稱前綴 */
  const getProvider = (app: SkillsApiApp): string => {
    if (app.name.startsWith('google_') || app.name === 'gmail' || app.name === 'youtube') return 'google';
    return app.name;
  };

  /* 初始位置：沿橢圓分佈，避免初始重疊 */
  const positions = apps.map((_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const rx = 400 + n * 30;
    const ry = 300 + n * 20;
    return {
      x: CANVAS_CENTER.x + Math.cos(angle) * rx,
      y: CANVAS_CENTER.y + Math.sin(angle) * ry,
      vx: 0,
      vy: 0,
    };
  });

  /* 迭代模擬 */
  for (let iter = 0; iter < SIM_ITERATIONS; iter++) {
    const cooling = 1 - iter / SIM_ITERATIONS; // 線性降溫

    for (let i = 0; i < n; i++) {
      let fx = 0, fy = 0;

      /* 斥力：與其他所有 App */
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const minDist = radii[i] + radii[j] + 80; // 最小間距
        const force = REPULSION / (dist * dist);
        /* 太近時額外加大斥力 */
        const overlap = dist < minDist ? (minDist - dist) * 2 : 0;
        fx += (dx / dist) * (force + overlap);
        fy += (dy / dist) * (force + overlap);
      }

      /* 吸引力：同 OAuth provider 的 App */
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

      /* 中心引力 */
      fx += (CANVAS_CENTER.x - positions[i].x) * CENTER_PULL;
      fy += (CANVAS_CENTER.y - positions[i].y) * CENTER_PULL;

      positions[i].vx = (positions[i].vx + fx) * cooling * 0.5;
      positions[i].vy = (positions[i].vy + fy) * cooling * 0.5;
    }

    /* 套用速度 */
    for (let i = 0; i < n; i++) {
      positions[i].x += positions[i].vx;
      positions[i].y += positions[i].vy;
    }
  }

  /* 建立結果 Map */
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

/* ── action 群聚佈局 ── */

/**
 * 在 cluster 內以有機、不規則的方式排列 action 圓點
 * 使用黃金角螺旋（phyllotaxis）產生自然群聚效果
 */
function placeActions(
  cx: number,
  cy: number,
  count: number,
  clusterRadius: number,
): Array<{ x: number; y: number }> {
  if (count === 0) return [];

  const positions: Array<{ x: number; y: number }> = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~137.5°

  /* action 分佈半徑：從中心 40% 到邊緣 85% */
  const innerR = clusterRadius * 0.35;
  const outerR = clusterRadius * 0.85;

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const r = innerR + (outerR - innerR) * Math.sqrt(t); // sqrt 讓外圍更密
    const angle = i * goldenAngle;
    positions.push({
      x: Math.round(cx + Math.cos(angle) * r),
      y: Math.round(cy + Math.sin(angle) * r),
    });
  }

  return positions;
}

/* ── 主要建構函式 ── */

/**
 * 根據 API 回傳的 apps + combos，用力導向佈局動態產生技能樹
 */
export function buildSkillTree(
  apps: SkillsApiApp[],
  combos: SkillsApiCombo[],
): {
  nodes: SkillNode[];
  edges: SkillEdge[];
} {
  const nodes: SkillNode[] = [];
  const edges: SkillEdge[] = [];

  /* 1. 力導向計算 App 中心位置 */
  const layout = forceDirectedLayout(apps);

  /* 2. 為每個 App 建立 cluster */
  apps.forEach((app) => {
    const pos = layout.get(app.name);
    if (!pos) return;
    const { x: cx, y: cy, radius } = pos;
    const label = app.displayName.zh || app.displayName.en || app.name;

    /* Source 節點（App） */
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

    /* Action 節點（小圓點） */
    const actionPositions = placeActions(cx, cy, app.actions.length, radius);
    app.actions.forEach((action, i) => {
      const actionId = `${app.name}--${action.name}`;
      nodes.push({
        id: actionId,
        label: action.name,
        type: 'skill',
        status: app.connected ? 'unlocked' : 'locked',
        x: actionPositions[i].x,
        y: actionPositions[i].y,
        description: action.description,
        app: app.name,
      });
      edges.push({ from: app.name, to: actionId, type: 'normal' });
    });
  });

  /* 3. 組合技節點 — 位置根據前置 App 的重心計算 */
  combos.forEach((combo) => {
    const requiredApps = [...new Set(combo.prerequisites.map(p => p.app))];

    /* 計算前置 App 的重心 */
    let sumX = 0, sumY = 0, count = 0;
    requiredApps.forEach(appName => {
      const pos = layout.get(appName);
      if (pos) { sumX += pos.x; sumY += pos.y; count++; }
    });

    /* 重心往下偏移，避免跟 App 節點重疊 */
    const comboX = count > 0 ? Math.round(sumX / count) : CANVAS_CENTER.x;
    const comboY = count > 0 ? Math.round(sumY / count + 120) : CANVAS_CENTER.y + 200;

    nodes.push({
      id: combo.id,
      label: combo.name.zh,
      type: 'combo',
      status: combo.unlocked ? 'unlocked' : 'locked',
      x: comboX,
      y: comboY,
      description: combo.description.zh,
      prerequisites: requiredApps,
    });

    requiredApps.forEach(appName => {
      edges.push({ from: appName, to: combo.id, type: 'combo' });
    });
  });

  /* 4. 組合技之間的排斥（避免重疊） */
  const comboNodes = nodes.filter(n => n.type === 'combo');
  for (let iter = 0; iter < 30; iter++) {
    for (let i = 0; i < comboNodes.length; i++) {
      for (let j = i + 1; j < comboNodes.length; j++) {
        const dx = comboNodes[i].x - comboNodes[j].x;
        const dy = comboNodes[i].y - comboNodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = 120;
        if (dist < minDist && dist > 0) {
          const push = (minDist - dist) / 2;
          const nx = dx / dist, ny = dy / dist;
          comboNodes[i].x += Math.round(nx * push);
          comboNodes[i].y += Math.round(ny * push);
          comboNodes[j].x -= Math.round(nx * push);
          comboNodes[j].y -= Math.round(ny * push);
        }
      }
    }
  }

  return { nodes, edges };
}
