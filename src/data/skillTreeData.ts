/**
 * 技能樹資料定義 — 三圈同心圓佈局
 * 外圈：App 源技能（方形）— 半徑 550px
 * 中圈：Action 技能（圓點）— App 往中心方向偏移
 * 內圈：組合技（菱形）— 半徑 120px
 * 所有座標演算法計算，新增 App / action / combo 時自動重算
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
  descriptionEn?: string;
  app?: string;
  authType?: string;
  actionCount?: number;
  prerequisites?: Array<{ nodeId: string; label: string; app: string }>;
}

/** 技能樹邊 */
export interface SkillEdge {
  from: string;
  to: string;
  type: 'normal' | 'combo';
}

/** API 回傳的 App 資料 */
export interface SkillsApiApp {
  name: string;
  displayName: Record<string, string>;
  authType: string;
  connected: boolean;
  connectedAt: string | null;
  actions: Array<{ name: string; description: { zh: string; en: string } }>;
}

/** API 回傳的組合技資料 */
export interface SkillsApiCombo {
  id: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  prerequisites: Array<{ app: string; action: string }>;
  unlocked: boolean;
}

/* ── 佈局常數 ── */
const CENTER = { x: 900, y: 700 };
const APP_RING_RADIUS = 550;       // 外圈 App 半徑
const COMBO_RING_RADIUS = 120;     // 內圈組合技半徑
const BASE_CLUSTER_R = 40;         // action cluster 基礎半徑（衛星環繞 App）
const CLUSTER_R_PER_ACTION = 4;    // 每多一個 action 加的半徑

/* ── OAuth provider 分群 ── */

/**
 * 判斷 App 的 OAuth provider（用於分群排列）
 * 從 adapter 的 authType 和名稱前綴推斷，不寫死
 */
function getOAuthProvider(app: SkillsApiApp): string {
  if (app.authType !== 'oauth2') return `__${app.authType}`;
  /* Google 系列：名稱以 google_ 開頭，或是 gmail / youtube */
  if (app.name.startsWith('google_') || app.name === 'gmail' || app.name === 'youtube') return 'google';
  /* Meta 系列 */
  if (app.name === 'threads' || app.name === 'instagram') return 'meta';
  /* 其他各自成群 */
  return app.name;
}

/**
 * 按 OAuth provider 分群排序
 * 同群的 App 排相鄰，群內按名稱字母排序
 * 回傳排好序的 index 陣列
 */
function sortAppsByProvider(apps: SkillsApiApp[]): number[] {
  const indexed = apps.map((app, i) => ({ app, i, provider: getOAuthProvider(app) }));
  /* 群排序：先按 provider 字母排，群內按 App 名稱排 */
  indexed.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.app.name.localeCompare(b.app.name);
  });
  return indexed.map(item => item.i);
}

/* ── 黃金角螺旋排列 action ── */

function placeActionsInCluster(
  anchorX: number,
  anchorY: number,
  count: number,
  clusterR: number,
): Array<{ x: number; y: number }> {
  if (count === 0) return [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const positions: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const r = clusterR * 0.25 + clusterR * 0.75 * Math.sqrt(t);
    const angle = i * goldenAngle;
    positions.push({
      x: Math.round(anchorX + Math.cos(angle) * r),
      y: Math.round(anchorY + Math.sin(angle) * r),
    });
  }
  return positions;
}

/* ── 主要建構函式 ── */

export function buildSkillTree(
  apps: SkillsApiApp[],
  combos: SkillsApiCombo[],
): { nodes: SkillNode[]; edges: SkillEdge[] } {
  const nodes: SkillNode[] = [];
  const edges: SkillEdge[] = [];

  const connectedSet = new Set(apps.filter(a => a.connected).map(a => a.name));

  /* ── 外圈：App 源技能 ── */

  /* 按 provider 分群排序後，均勻分配到圓周 */
  const sortedIndices = sortAppsByProvider(apps);
  const n = apps.length;

  /* appPositions: app name → { x, y, angle } */
  const appPositions = new Map<string, { x: number; y: number; angle: number }>();

  sortedIndices.forEach((origIdx, sortPos) => {
    const app = apps[origIdx];
    const angle = (sortPos / n) * Math.PI * 2 - Math.PI / 2; // 從頂部開始
    const x = Math.round(CENTER.x + Math.cos(angle) * APP_RING_RADIUS);
    const y = Math.round(CENTER.y + Math.sin(angle) * APP_RING_RADIUS);
    appPositions.set(app.name, { x, y, angle });

    const label = app.displayName.zh || app.displayName.en || app.name;
    nodes.push({
      id: app.name,
      label,
      type: 'source',
      status: app.connected ? 'unlocked' : 'locked',
      x, y,
      description: `${label} 整合`,
      app: app.name,
      authType: app.authType,
      actionCount: app.actions.length,
    });
  });

  /* ── Action 技能（衛星環繞 App） ── */

  apps.forEach((app) => {
    const appPos = appPositions.get(app.name);
    if (!appPos) return;

    /* action 以 App 為中心向外展開（衛星群） */
    const clusterR = BASE_CLUSTER_R + app.actions.length * CLUSTER_R_PER_ACTION;
    const actionPositions = placeActionsInCluster(appPos.x, appPos.y, app.actions.length, clusterR);

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

  /* ── 內圈：組合技 ── */

  combos.forEach((combo, ci) => {
    const angle = combos.length === 1
      ? 0
      : (ci / combos.length) * Math.PI * 2 - Math.PI / 2;
    const x = Math.round(CENTER.x + Math.cos(angle) * COMBO_RING_RADIUS);
    const y = Math.round(CENTER.y + Math.sin(angle) * COMBO_RING_RADIUS);

    const prereqNodes = combo.prerequisites.map(p => ({
      nodeId: `${p.app}--${p.action}`,
      label: nodes.find(nd => nd.id === `${p.app}--${p.action}`)?.label ?? p.action,
      app: p.app,
    }));

    const requiredApps = [...new Set(combo.prerequisites.map(p => p.app))];
    const isUnlocked = requiredApps.every(a => connectedSet.has(a));

    nodes.push({
      id: combo.id,
      label: combo.name.zh,
      type: 'combo',
      status: isUnlocked ? 'unlocked' : 'locked',
      x, y,
      description: combo.description.zh,
      descriptionEn: combo.description.en,
      prerequisites: prereqNodes,
    });

    /* 邊：連到具體 action 節點 */
    combo.prerequisites.forEach(p => {
      edges.push({ from: `${p.app}--${p.action}`, to: combo.id, type: 'combo' });
    });
  });

  return { nodes, edges };
}
