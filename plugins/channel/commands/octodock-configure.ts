// ============================================================
// /octodock:configure slash command
// 讓用戶設定 OctoDock API key（從 Dashboard 取得）
// 用法：/octodock:configure ak_your_api_key_here
// ============================================================

import { saveConfig, loadConfig } from "../src/config.js";

const args = process.argv.slice(2);
const apiKey = args[0];

if (!apiKey) {
  const current = loadConfig();
  if (current.apiKey) {
    console.log(`Current API key: ${current.apiKey.slice(0, 8)}...`);
    console.log("To update: /octodock:configure <new_api_key>");
  } else {
    console.log("No API key configured.");
    console.log("");
    console.log("Steps:");
    console.log("1. Go to https://octo-dock.com/dashboard");
    console.log("2. Copy your MCP API key (starts with ak_)");
    console.log("3. Run: /octodock:configure ak_your_key_here");
  }
} else if (!apiKey.startsWith("ak_")) {
  console.error("Invalid API key format. It should start with 'ak_'.");
  console.error("Get your key from https://octo-dock.com/dashboard");
} else {
  saveConfig({ apiKey });
  console.log("API key configured successfully!");
  console.log("Restart Claude Code with --channels to enable event streaming.");
}
