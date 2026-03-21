#!/usr/bin/env npx tsx
/**
 * Middleware 覆蓋率檢查腳本
 * 掃描所有 adapter 的 actionMap，比對 param-guard / error-hints 的覆蓋範圍
 * 產出覆蓋率報告，缺口一目了然
 *
 * 執行：npx tsx scripts/check-middleware-coverage.ts
 */

import * as fs from "fs";
import * as path from "path";

// 掃描 adapters 目錄
const ADAPTERS_DIR = path.join(__dirname, "../src/adapters");
const PARAM_GUARD_PATH = path.join(__dirname, "../src/mcp/middleware/param-guard.ts");
const ERROR_HINTS_PATH = path.join(__dirname, "../src/mcp/error-hints.ts");

interface CoverageReport {
  app: string;
  totalActions: number;
  paramGuardCovered: number;
  paramGuardMissing: string[];
  errorHintsCovered: boolean;
  hasExtractSummary: boolean;
  hasFormatError: boolean;
}

function main() {
  console.log("=== OctoDock Middleware 覆蓋率報告 ===\n");

  // 讀取 param-guard 的 REQUIRED_PARAMS
  const paramGuardContent = fs.readFileSync(PARAM_GUARD_PATH, "utf-8");
  const requiredParamsMatch = paramGuardContent.match(/REQUIRED_PARAMS.*?=\s*\{([\s\S]*?)\n\s*\};/);
  const requiredParamsText = requiredParamsMatch?.[1] ?? "";

  // 讀取 error-hints 的 APP_HINTS
  const errorHintsContent = fs.readFileSync(ERROR_HINTS_PATH, "utf-8");

  // 掃描所有 adapter 檔案
  const adapterFiles = fs.readdirSync(ADAPTERS_DIR)
    .filter((f) => f.endsWith(".ts") && f !== "types.ts");

  const reports: CoverageReport[] = [];

  for (const file of adapterFiles) {
    const content = fs.readFileSync(path.join(ADAPTERS_DIR, file), "utf-8");

    // 提取 app name — 從 adapter export 的 name 欄位（不是 displayName）
    // adapter 結構：export const xxxAdapter: AppAdapter = { name: "xxx", ... }
    const nameMatch = content.match(/:\s*AppAdapter\s*=\s*\{[\s\S]*?name:\s*["']([^"']+)["']/);
    const appName = nameMatch?.[1] ?? file.replace(".ts", "");

    // 提取 actionMap
    const actionMapMatch = content.match(/actionMap[^{]*\{([\s\S]+?)\n\s*\}/);
    if (!actionMapMatch) continue;
    const actionLines = actionMapMatch[1].match(/\w+:\s*["'][^"']+["']/g) ?? [];
    const actions = actionLines.map((l) => {
      const parts = l.split(":");
      return { action: parts[0].trim(), toolName: parts[1].trim().replace(/["']/g, "") };
    });

    // 檢查 param-guard 覆蓋率
    const paramGuardCovered = actions.filter((a) =>
      requiredParamsText.includes(a.toolName),
    );
    const paramGuardMissing = actions
      .filter((a) => !requiredParamsText.includes(a.toolName))
      .map((a) => a.action);

    // 檢查 error-hints 覆蓋率
    const errorHintsCovered = errorHintsContent.includes(`"${appName}"`) || errorHintsContent.includes(`'${appName}'`);

    // 檢查 extractSummary
    const hasExtractSummary = content.includes("extractSummary");

    // 檢查 formatError
    const hasFormatError = content.includes("formatError");

    reports.push({
      app: appName,
      totalActions: actions.length,
      paramGuardCovered: paramGuardCovered.length,
      paramGuardMissing,
      errorHintsCovered,
      hasExtractSummary,
      hasFormatError,
    });
  }

  // 輸出報告
  let totalActions = 0;
  let totalCovered = 0;
  let totalMissing = 0;

  for (const r of reports) {
    totalActions += r.totalActions;
    totalCovered += r.paramGuardCovered;
    totalMissing += r.paramGuardMissing.length;

    const coverage = r.totalActions > 0
      ? Math.round((r.paramGuardCovered / r.totalActions) * 100)
      : 0;

    const status = coverage >= 80 ? "✅" : coverage >= 50 ? "⚠️" : "❌";

    console.log(`${status} ${r.app} (${r.totalActions} actions)`);
    console.log(`   param-guard: ${r.paramGuardCovered}/${r.totalActions} (${coverage}%)`);
    if (r.paramGuardMissing.length > 0) {
      console.log(`   missing: ${r.paramGuardMissing.join(", ")}`);
    }
    console.log(`   error-hints: ${r.errorHintsCovered ? "✅" : "❌"}`);
    console.log(`   extractSummary: ${r.hasExtractSummary ? "✅" : "❌"}`);
    console.log(`   formatError: ${r.hasFormatError ? "✅" : "❌"}`);
    console.log();
  }

  // 總結
  const overallCoverage = totalActions > 0
    ? Math.round((totalCovered / totalActions) * 100)
    : 0;
  console.log("=== 總結 ===");
  console.log(`總 actions: ${totalActions}`);
  console.log(`param-guard 覆蓋: ${totalCovered}/${totalActions} (${overallCoverage}%)`);
  console.log(`param-guard 缺口: ${totalMissing}`);

  // 非零退出碼如果覆蓋率太低
  if (overallCoverage < 30) {
    console.log("\n⚠️ 覆蓋率低於 30%，建議補齊 REQUIRED_PARAMS");
    process.exit(1);
  }
}

main();
