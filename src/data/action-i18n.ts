/**
 * Action 名稱 → 中文翻譯對照表
 * 用於技能樹 tooltip 和側邊欄的多語系顯示
 * 格式：{ "app_name.action_name": "中文名稱" }
 * 找不到的 action 會用 action name 的自動直譯作為 fallback
 */

const ACTION_ZH: Record<string, string> = {
  /* ── Notion ── */
  "notion.search": "搜尋",
  "notion.get_page": "取得頁面",
  "notion.create_page": "建立頁面",
  "notion.update_page": "更新頁面",
  "notion.replace_content": "替換內容",
  "notion.append_content": "追加內容",
  "notion.move_page": "移動頁面",
  "notion.delete_page": "刪除頁面",
  "notion.get_page_property": "取得頁面屬性",
  "notion.get_block": "取得區塊",
  "notion.get_block_children": "取得子區塊",
  "notion.append_blocks": "追加區塊",
  "notion.update_block": "更新區塊",
  "notion.delete_block": "刪除區塊",
  "notion.query_database": "查詢資料庫",
  "notion.create_database_item": "新增資料庫項目",
  "notion.create_database": "建立資料庫",
  "notion.update_database": "更新資料庫",
  "notion.add_comment": "新增留言",
  "notion.get_comments": "取得留言",
  "notion.get_users": "取得用戶清單",

  /* ── Gmail ── */
  "gmail.search": "搜尋信件",
  "gmail.read": "讀取信件",
  "gmail.send": "寄信",
  "gmail.reply": "回信",
  "gmail.draft": "建立草稿",
  "gmail.label_list": "標籤清單",
  "gmail.trash": "移至垃圾桶",
  "gmail.untrash": "從垃圾桶還原",
  "gmail.archive": "封存信件",
  "gmail.mark_read": "標為已讀",
  "gmail.mark_unread": "標為未讀",
  "gmail.get_attachment": "下載附件",
  "gmail.list_threads": "對話串列表",
  "gmail.get_thread": "取得對話串",
  "gmail.list_drafts": "草稿列表",
  "gmail.get_draft": "取得草稿",
  "gmail.send_draft": "發送草稿",
  "gmail.delete_draft": "刪除草稿",

  /* ── Google Calendar ── */
  "google_calendar.list_calendars": "日曆清單",
  "google_calendar.get_events": "查詢事件",
  "google_calendar.get_event": "取得事件",
  "google_calendar.create_event": "建立事件",
  "google_calendar.update_event": "更新事件",
  "google_calendar.delete_event": "刪除事件",
  "google_calendar.quick_add": "快速新增",
  "google_calendar.freebusy": "空閒查詢",
  "google_calendar.list_recurring": "週期事件",
  "google_calendar.create_calendar": "建立日曆",
  "google_calendar.delete_calendar": "刪除日曆",

  /* ── Google Drive ── */
  "google_drive.search": "搜尋檔案",
  "google_drive.get_file": "取得檔案資訊",
  "google_drive.download": "下載檔案",
  "google_drive.create": "建立檔案",
  "google_drive.update": "更新檔案",
  "google_drive.delete": "刪除檔案",
  "google_drive.share": "分享檔案",
  "google_drive.copy": "複製檔案",
  "google_drive.move": "移動檔案",
  "google_drive.create_folder": "建立資料夾",
  "google_drive.export": "匯出檔案",
  "google_drive.list_permissions": "權限清單",
  "google_drive.add_comment": "新增留言",

  /* ── Google Sheets ── */
  "google_sheets.create": "建立試算表",
  "google_sheets.get": "取得試算表資訊",
  "google_sheets.read": "讀取儲存格",
  "google_sheets.write": "寫入儲存格",
  "google_sheets.append": "追加資料列",
  "google_sheets.clear": "清除儲存格",
  "google_sheets.add_sheet": "新增工作表",
  "google_sheets.delete_sheet": "刪除工作表",
  "google_sheets.rename_sheet": "重新命名工作表",
  "google_sheets.batch_update": "批次更新",

  /* ── Google Tasks ── */
  "google_tasks.list_tasklists": "工作清單列表",
  "google_tasks.list_tasks": "工作項目列表",
  "google_tasks.get_task": "取得工作項目",
  "google_tasks.create_task": "建立工作項目",
  "google_tasks.update_task": "更新工作項目",
  "google_tasks.delete_task": "刪除工作項目",
  "google_tasks.complete_task": "完成工作項目",
  "google_tasks.move_task": "移動工作項目",
  "google_tasks.clear_completed": "清除已完成",
  "google_tasks.create_tasklist": "建立工作清單",
  "google_tasks.delete_tasklist": "刪除工作清單",

  /* ── Google Docs ── */
  "google_docs.create": "建立文件",
  "google_docs.get": "讀取文件",
  "google_docs.insert_text": "插入文字",
  "google_docs.replace_text": "取代文字",
  "google_docs.append_text": "追加文字",
  "google_docs.delete_text": "刪除文字",
  "google_docs.insert_table": "插入表格",

  /* ── YouTube ── */
  "youtube.search": "搜尋影片",
  "youtube.get_video": "取得影片資訊",
  "youtube.list_playlists": "播放清單列表",
  "youtube.list_playlist_items": "播放清單內容",
  "youtube.add_to_playlist": "加入播放清單",
  "youtube.get_comments": "取得留言",
  "youtube.get_channel": "取得頻道資訊",
  "youtube.upload_video": "上傳影片",
  "youtube.update_video": "更新影片",
  "youtube.delete_video": "刪除影片",
  "youtube.like_video": "按讚影片",
  "youtube.subscribe": "訂閱頻道",
  "youtube.create_playlist": "建立播放清單",
  "youtube.delete_playlist": "刪除播放清單",
  "youtube.reply_comment": "回覆留言",
  "youtube.post_comment": "發佈留言",

  /* ── GitHub ── */
  "github.list_repos": "Repo 列表",
  "github.get_repo": "取得 Repo",
  "github.search_code": "搜尋程式碼",
  "github.list_issues": "Issue 列表",
  "github.create_issue": "建立 Issue",
  "github.update_issue": "更新 Issue",
  "github.list_prs": "PR 列表",
  "github.get_pr": "取得 PR",
  "github.create_comment": "發佈留言",
  "github.get_file": "取得檔案",
  "github.create_file": "建立檔案",
  "github.update_file": "更新檔案",
  "github.delete_file": "刪除檔案",
  "github.list_branches": "分支列表",
  "github.create_pr": "建立 PR",
  "github.merge_pr": "合併 PR",
  "github.list_commits": "Commit 列表",
  "github.create_repo": "建立 Repo",
  "github.list_releases": "Release 列表",
  "github.create_release": "建立 Release",
  "github.list_workflows": "Workflow 列表",
  "github.trigger_workflow": "觸發 Workflow",
  "github.list_gists": "Gist 列表",
  "github.create_gist": "建立 Gist",
  "github.search_repos": "搜尋 Repo",
  "github.search_issues": "搜尋 Issue",
  "github.star_repo": "Star Repo",
  "github.fork_repo": "Fork Repo",
  "github.create_branch": "建立分支",
};

/** 自動直譯 fallback：snake_case → 中文（取底線分段用空格連接） */
function autoTranslate(actionName: string): string {
  const WORD_MAP: Record<string, string> = {
    search: "搜尋", list: "列表", get: "取得", create: "建立",
    update: "更新", delete: "刪除", read: "讀取", write: "寫入",
    send: "寄送", reply: "回覆", export: "匯出", import: "匯入",
    download: "下載", upload: "上傳", copy: "複製", move: "移動",
    share: "分享", clear: "清除", append: "追加", add: "新增",
    remove: "移除", mark: "標記", query: "查詢", batch: "批次",
    merge: "合併", fork: "Fork", star: "Star", trigger: "觸發",
    complete: "完成", rename: "重新命名", replace: "取代", insert: "插入",
  };
  const parts = actionName.split("_");
  const first = WORD_MAP[parts[0]] ?? parts[0];
  return parts.length === 1 ? first : `${first} ${parts.slice(1).join(" ")}`;
}

/**
 * 取得 action 的中文名稱
 * 優先查對照表，找不到用自動直譯
 */
export function getActionZh(appName: string, actionName: string): string {
  const key = `${appName}.${actionName}`;
  return ACTION_ZH[key] ?? autoTranslate(actionName);
}
