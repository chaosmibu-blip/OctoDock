import type { NextConfig } from "next";
import { execSync } from "child_process";

// Build time 注入 Git SHA 和時間戳，讓 octodock_help 可以顯示版本
const gitSha = (() => {
  try { return execSync("git rev-parse --short HEAD", { stdio: ["pipe", "pipe", "pipe"] }).toString().trim(); }
  catch { return process.env.REPL_SLUG ? "deployed" : "unknown"; }
})();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GIT_SHA: gitSha,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString().slice(0, 10),
  },
};

export default nextConfig;
