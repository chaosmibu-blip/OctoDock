/** 技能樹資料定義 — 節點類型、狀態、假資料 */

export type NodeStatus = 'unlocked' | 'pending' | 'locked';
export type NodeType = 'source' | 'skill' | 'combo';

export interface SkillNode {
  id: string;
  label: string;
  type: NodeType;
  status: NodeStatus;
  /** 當該 App 已連接時，此節點的固有狀態 */
  intrinsicStatus: NodeStatus;
  x: number;
  y: number;
  description: string;
  app?: string;
  prerequisites?: string[];
}

export interface SkillEdge {
  from: string;
  to: string;
  type: 'normal' | 'combo';
}

/* 各 App cluster 的中心座標 */
const clusters = {
  gmail:    { x: 300,  y: 350 },
  calendar: { x: 900,  y: 200 },
  notion:   { x: 1500, y: 350 },
  drive:    { x: 300,  y: 900 },
  youtube:  { x: 900,  y: 1050 },
  github:   { x: 1500, y: 900 },
};

/** 計算環形佈局位置 */
function radial(cx: number, cy: number, index: number, total: number, radius: number) {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

/* ── 各 App 的技能節點定義 ── */

const gmailSkills = [
  { id: 'gmail-search', label: '搜尋信件', intrinsicStatus: 'unlocked' as const, desc: '搜尋 Gmail 信箱中的郵件' },
  { id: 'gmail-read', label: '讀取信件', intrinsicStatus: 'unlocked' as const, desc: '讀取郵件內容與附件' },
  { id: 'gmail-send', label: '寄信', intrinsicStatus: 'unlocked' as const, desc: '撰寫並寄送新郵件' },
  { id: 'gmail-reply', label: '回信', intrinsicStatus: 'unlocked' as const, desc: '回覆已有的郵件' },
  { id: 'gmail-draft', label: '草稿', intrinsicStatus: 'unlocked' as const, desc: '建立與管理草稿' },
  { id: 'gmail-attach', label: '附件', intrinsicStatus: 'unlocked' as const, desc: '處理郵件附件' },
  { id: 'gmail-thread', label: '對話串', intrinsicStatus: 'pending' as const, desc: '管理完整對話串' },
  { id: 'gmail-labels', label: '標籤管理', intrinsicStatus: 'pending' as const, desc: '管理 Gmail 標籤與分類' },
];

const calSkills = [
  { id: 'cal-query', label: '查詢事件', intrinsicStatus: 'unlocked' as const, desc: '搜尋日曆中的事件' },
  { id: 'cal-create', label: '建立事件', intrinsicStatus: 'unlocked' as const, desc: '建立新的日曆事件' },
  { id: 'cal-update', label: '更新事件', intrinsicStatus: 'unlocked' as const, desc: '修改已有的事件' },
  { id: 'cal-free', label: '空閒查詢', intrinsicStatus: 'unlocked' as const, desc: '查詢空閒時段' },
  { id: 'cal-quick', label: '快速新增', intrinsicStatus: 'unlocked' as const, desc: '用自然語言快速建立事件' },
  { id: 'cal-delete', label: '刪除事件', intrinsicStatus: 'unlocked' as const, desc: '刪除日曆事件' },
  { id: 'cal-recur', label: '週期事件', intrinsicStatus: 'unlocked' as const, desc: '管理重複性週期事件' },
  { id: 'cal-move', label: '移動事件', intrinsicStatus: 'pending' as const, desc: '將事件移到其他日曆' },
];

const notionSkills = [
  { id: 'notion-search', label: '搜尋', intrinsicStatus: 'unlocked' as const, desc: '搜尋 Notion workspace' },
  { id: 'notion-create', label: '建立頁面', intrinsicStatus: 'unlocked' as const, desc: '在 Notion 建立新頁面' },
  { id: 'notion-read', label: '讀取內容', intrinsicStatus: 'unlocked' as const, desc: '讀取 Notion 頁面內容' },
  { id: 'notion-db', label: '資料庫查詢', intrinsicStatus: 'unlocked' as const, desc: '查詢 Notion 資料庫' },
  { id: 'notion-append', label: '追加內容', intrinsicStatus: 'unlocked' as const, desc: '向頁面追加新內容' },
  { id: 'notion-replace', label: '替換內容', intrinsicStatus: 'unlocked' as const, desc: '替換頁面中的內容' },
];

const driveSkills = [
  { id: 'drive-search', label: '搜尋檔案', intrinsicStatus: 'unlocked' as const, desc: '搜尋 Google Drive 檔案' },
  { id: 'drive-upload', label: '上傳', intrinsicStatus: 'unlocked' as const, desc: '上傳檔案到 Drive' },
  { id: 'drive-share', label: '分享', intrinsicStatus: 'unlocked' as const, desc: '分享檔案連結' },
  { id: 'drive-export', label: '匯出', intrinsicStatus: 'unlocked' as const, desc: '匯出特定格式的檔案' },
  { id: 'drive-copy', label: '複製', intrinsicStatus: 'unlocked' as const, desc: '複製 Drive 檔案' },
  { id: 'drive-comment', label: '留言管理', intrinsicStatus: 'pending' as const, desc: '管理檔案上的留言' },
  { id: 'drive-perm', label: '權限管理', intrinsicStatus: 'pending' as const, desc: '管理檔案存取權限' },
];

const ytSkills = [
  { id: 'yt-search', label: '搜尋影片', intrinsicStatus: 'unlocked' as const, desc: '搜尋 YouTube 影片' },
  { id: 'yt-info', label: '影片資訊', intrinsicStatus: 'unlocked' as const, desc: '取得影片詳細資訊' },
  { id: 'yt-playlist', label: '播放清單', intrinsicStatus: 'unlocked' as const, desc: '管理播放清單' },
  { id: 'yt-comment', label: '留言', intrinsicStatus: 'unlocked' as const, desc: '讀取與發佈留言' },
  { id: 'yt-upload', label: '上傳影片', intrinsicStatus: 'unlocked' as const, desc: '上傳影片到 YouTube' },
  { id: 'yt-caption', label: '字幕下載', intrinsicStatus: 'pending' as const, desc: '下載影片字幕' },
];

const ghSkills = [
  { id: 'gh-repos', label: 'Repos', intrinsicStatus: 'unlocked' as const, desc: '管理 GitHub 儲存庫' },
  { id: 'gh-issues', label: 'Issues', intrinsicStatus: 'unlocked' as const, desc: '管理 GitHub Issues' },
  { id: 'gh-prs', label: 'PRs', intrinsicStatus: 'unlocked' as const, desc: '管理 Pull Requests' },
  { id: 'gh-files', label: '檔案操作', intrinsicStatus: 'unlocked' as const, desc: '讀取與修改 Repo 檔案' },
  { id: 'gh-actions', label: 'Actions 監控', intrinsicStatus: 'pending' as const, desc: '監控 GitHub Actions 狀態' },
  { id: 'gh-review', label: 'PR Review', intrinsicStatus: 'pending' as const, desc: '自動化 PR 審查流程' },
];

/** 根據 App 中心座標與技能列表，產生 cluster 的節點和邊 */
function buildCluster(
  appId: string, appLabel: string, cx: number, cy: number,
  skills: { id: string; label: string; intrinsicStatus: NodeStatus; desc: string }[]
): { nodes: SkillNode[]; edges: SkillEdge[] } {
  const nodes: SkillNode[] = [
    { id: appId, label: appLabel, type: 'source', status: 'unlocked', intrinsicStatus: 'unlocked', x: cx, y: cy, description: `${appLabel} 整合`, app: appId },
  ];
  const edges: SkillEdge[] = [];
  skills.forEach((s, i) => {
    const pos = radial(cx, cy, i, skills.length, 160);
    nodes.push({ id: s.id, label: s.label, type: 'skill', status: s.intrinsicStatus, intrinsicStatus: s.intrinsicStatus, x: pos.x, y: pos.y, description: s.desc, app: appId });
    edges.push({ from: appId, to: s.id, type: 'normal' });
  });
  return { nodes, edges };
}

/* 組合所有 cluster */
const allClusters = [
  buildCluster('gmail', 'Gmail', clusters.gmail.x, clusters.gmail.y, gmailSkills),
  buildCluster('calendar', 'Calendar', clusters.calendar.x, clusters.calendar.y, calSkills),
  buildCluster('notion', 'Notion', clusters.notion.x, clusters.notion.y, notionSkills),
  buildCluster('drive', 'Drive', clusters.drive.x, clusters.drive.y, driveSkills),
  buildCluster('youtube', 'YouTube', clusters.youtube.x, clusters.youtube.y, ytSkills),
  buildCluster('github', 'GitHub', clusters.github.x, clusters.github.y, ghSkills),
];

/* ── 組合技節點（跨 App 技能） ── */
const comboNodes: SkillNode[] = [
  {
    id: 'combo-email-archive', label: '信件摘要歸檔', type: 'combo', status: 'locked', intrinsicStatus: 'unlocked',
    x: 900, y: 550, description: '自動摘要 Gmail 對話串並歸檔到 Notion',
    prerequisites: ['gmail-thread', 'notion-create'],
  },
  {
    id: 'combo-meeting-prep', label: '會議準備助手', type: 'combo', status: 'locked', intrinsicStatus: 'unlocked',
    x: 600, y: 600, description: '根據日曆事件自動搜尋相關文件並發送準備郵件',
    prerequisites: ['cal-query', 'drive-search', 'gmail-send'],
  },
  {
    id: 'combo-video-doc', label: '影片內容轉文件', type: 'combo', status: 'locked', intrinsicStatus: 'unlocked',
    x: 1200, y: 750, description: '下載 YouTube 字幕並自動建立 Notion 文件',
    prerequisites: ['yt-caption', 'notion-create'],
  },
  {
    id: 'combo-code-review', label: 'AI Code Review', type: 'combo', status: 'locked', intrinsicStatus: 'unlocked',
    x: 1500, y: 650, description: '自動化 Pull Request 審查流程',
    prerequisites: ['gh-prs', 'gh-review'],
  },
];

/* 組合技的邊（前置技能 → 組合技） */
const comboEdges: SkillEdge[] = comboNodes.flatMap(combo =>
  (combo.prerequisites || []).map(pre => ({ from: pre, to: combo.id, type: 'combo' as const }))
);

/* 匯出所有節點和邊 */
export const nodes: SkillNode[] = [
  ...allClusters.flatMap(c => c.nodes),
  ...comboNodes,
];

export const edges: SkillEdge[] = [
  ...allClusters.flatMap(c => c.edges),
  ...comboEdges,
];
