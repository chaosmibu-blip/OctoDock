#!/usr/bin/env node

// ============================================================
// 排程引擎自動觸發器
// 每分鐘 POST http://localhost:3000/api/scheduler
// 帶 SCHEDULER_SECRET 驗證身份
//
// 由 .replit 的 run command 啟動，Replit 重啟後自動恢復
// ============================================================

const INTERVAL_MS = 60 * 1000; // 每分鐘觸發一次
const PORT = process.env.PORT || "3000";
const BASE_URL = `http://localhost:${PORT}`;
const SECRET = process.env.SCHEDULER_SECRET || "";

// 等待 server 啟動的初始延遲（秒）
const STARTUP_DELAY_MS = 15 * 1000;

/** 記錄 log（附時間戳） */
function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[scheduler-ticker] ${ts} ${msg}`);
}

/** 觸發排程引擎一次 */
async function tick() {
  try {
    const headers = { "Content-Type": "application/json" };
    if (SECRET) {
      headers["Authorization"] = `Bearer ${SECRET}`;
    }

    const res = await fetch(`${BASE_URL}/api/scheduler`, {
      method: "POST",
      headers,
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      log(`✓ tick OK (${data.timestamp || "no timestamp"})`);
    } else {
      log(`✗ tick failed: ${res.status} ${data.error || ""}`);
    }
  } catch (err) {
    // server 可能還沒啟動，靜默重試
    log(`✗ fetch error: ${err.message}`);
  }
}

// 主流程
log(`啟動，目標 ${BASE_URL}/api/scheduler，每 ${INTERVAL_MS / 1000}s 觸發一次`);
if (!SECRET) {
  log("⚠ SCHEDULER_SECRET 未設定，請在 Replit Secrets 加入");
}

// 等待 server 啟動後開始
log(`等待 ${STARTUP_DELAY_MS / 1000}s 讓 server 啟動...`);
setTimeout(() => {
  // 立即觸發一次
  tick();
  // 之後每分鐘觸發
  setInterval(tick, INTERVAL_MS);
  log("定時器已啟動");
}, STARTUP_DELAY_MS);
