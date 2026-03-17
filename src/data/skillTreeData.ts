/**
 * 技能樹資料定義 — 類型、佈局計算
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
  app?: string;           // 所屬 App 名稱
  authType?: string;      // source 節點的認證方式
  prerequisites?: string[]; // combo 節點的前置 App 名稱
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

/* ── 佈局工具 ── */

/** 計算環形佈局位置 */
function radial(cx: number, cy: number, index: number, total: number, radius: number) {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

/** 計算 cluster 中心座標（3 列網格佈局） */
function computeClusterCenters(count: number): Array<{ x: number; y: number }> {
  const cols = 3;
  const xSpacing = 600;
  const ySpacing = 550;
  const xOffset = 300;
  const yOffset = 300;
  const centers: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    centers.push({ x: xOffset + col * xSpacing, y: yOffset + row * ySpacing });
  }
  return centers;
}

/* ── 主要建構函式 ── */

/**
 * 根據 API 回傳的 apps + combos 陣列，動態產生技能樹的節點和邊
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
  const centers = computeClusterCenters(apps.length);

  /* 為每個 App 建立 cluster */
  apps.forEach((app, appIndex) => {
    const { x: cx, y: cy } = centers[appIndex];
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
    });

    /* Action 節點（技能） */
    const actionRadius = Math.max(160, app.actions.length * 12);
    app.actions.forEach((action, actionIndex) => {
      const pos = radial(cx, cy, actionIndex, app.actions.length, actionRadius);
      const actionId = `${app.name}--${action.name}`;

      nodes.push({
        id: actionId,
        label: action.name,
        type: 'skill',
        status: app.connected ? 'unlocked' : 'locked',
        x: pos.x,
        y: pos.y,
        description: action.description,
        app: app.name,
      });

      edges.push({ from: app.name, to: actionId, type: 'normal' });
    });
  });

  /* 組合技節點 — 放在整個畫面的底部區域 */
  if (combos.length > 0) {
    const maxRow = Math.ceil(apps.length / 3);
    const comboBaseY = 300 + maxRow * 550 + 100;
    const comboSpacing = 350;
    const totalComboWidth = comboSpacing * (combos.length - 1);
    const canvasWidth = 3 * 600;
    const comboStartX = (canvasWidth - totalComboWidth) / 2 + 300;

    combos.forEach((combo, i) => {
      /* 收集此組合技需要的 App 名稱（去重） */
      const requiredApps = [...new Set(combo.prerequisites.map(p => p.app))];

      nodes.push({
        id: combo.id,
        label: combo.name.zh,
        type: 'combo',
        status: combo.unlocked ? 'unlocked' : 'locked',
        x: comboStartX + i * comboSpacing,
        y: comboBaseY,
        description: combo.description.zh,
        prerequisites: requiredApps,
      });

      /* 邊：前置 App source 節點 → combo 節點 */
      requiredApps.forEach(appName => {
        edges.push({ from: appName, to: combo.id, type: 'combo' });
      });
    });
  }

  return { nodes, edges };
}
