import { randomBytes } from "crypto";

export function generateMcpApiKey(): string {
  return `ak_${randomBytes(24).toString("hex")}`;
}

export const APP_NAME = "OctoDock";
export const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
