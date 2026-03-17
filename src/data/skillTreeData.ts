/**
 * 技能樹資料定義 — 類型、佈局計算、組合技定義
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
  prerequisites?: string[]; // combo 節點的前置 App
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

/* ── 佈局常數 ── */

/** 計算環形佈局位置 */
function radial(cx: number, cy: number, index: number, total: number, radius: number) {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

/** 計算 cluster 中心座標（3 列網格佈局，根據 App 數量動態排列） */
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

/* ── 組合技定義（寫死） ── */

/** 組合技的前置條件定義 */
const COMBO_DEFINITIONS = [
  {
    id: 'combo-email-archive',
    label: '信件摘要歸檔',
    description: '自動摘要 Gmail 對話串並歸檔到 Notion',
    requiredApps: ['gmail', 'notion'],
  },
  {
    id: 'combo-meeting-prep',
    label: '會議準備助手',
    description: '根據日曆事件自動搜尋相關文件並發送準備郵件',
    requiredApps: ['google_calendar', 'google_drive', 'gmail'],
  },
  {
    id: 'combo-video-doc',
    label: '影片內容轉文件',
    description: '下載 YouTube 字幕並自動建立 Notion 文件',
    requiredApps: ['youtube', 'notion'],
  },
  {
    id: 'combo-code-review',
    label: 'AI Code Review',
    description: '自動化 Pull Request 審查流程',
    requiredApps: ['github'],
  },
];

/* ── 主要建構函式 ── */

/**
 * 根據 API 回傳的 apps 陣列，動態產生技能樹的節點和邊
 */
export function buildSkillTree(apps: SkillsApiApp[]): {
  nodes: SkillNode[];
  edges: SkillEdge[];
} {
  const nodes: SkillNode[] = [];
  const edges: SkillEdge[] = [];
  const centers = computeClusterCenters(apps.length);

  /* 已連接 App 的 Set（用於組合技判斷） */
  const connectedSet = new Set(apps.filter(a => a.connected).map(a => a.name));

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

  /* 組合技節點 — 放在整個畫面的底部中央區域 */
  const maxRow = Math.ceil(apps.length / 3);
  const comboBaseY = 300 + maxRow * 550 + 100;
  const comboSpacing = 400;
  const comboStartX = 300 + (3 * 600 - comboSpacing * (COMBO_DEFINITIONS.length - 1)) / 2 - 300;

  COMBO_DEFINITIONS.forEach((combo, i) => {
    /* 判斷所有前置 App 是否已連接 */
    const allConnected = combo.requiredApps.every(appName => connectedSet.has(appName));

    nodes.push({
      id: combo.id,
      label: combo.label,
      type: 'combo',
      status: allConnected ? 'unlocked' : 'locked',
      x: comboStartX + i * comboSpacing,
      y: comboBaseY,
      description: combo.description,
      prerequisites: combo.requiredApps,
    });

    /* 邊：前置 App source 節點 → combo 節點 */
    combo.requiredApps.forEach(appName => {
      edges.push({ from: appName, to: combo.id, type: 'combo' });
    });
  });

  return { nodes, edges };
}
