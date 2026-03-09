import { readdirSync } from "fs";
import { join } from "path";
import { type AppAdapter, isAppAdapter } from "@/adapters/types";

const adapters = new Map<string, AppAdapter>();

export async function loadAdapters(): Promise<void> {
  const adapterDir = join(process.cwd(), "src", "adapters");
  const files = readdirSync(adapterDir).filter(
    (f) => f !== "types.ts" && f.endsWith(".ts"),
  );

  for (const file of files) {
    try {
      const mod = await import(`@/adapters/${file.replace(".ts", "")}`);
      const adapter = Object.values(mod).find(isAppAdapter);
      if (adapter) {
        adapters.set(adapter.name, adapter);
      }
    } catch (error) {
      console.error(`Failed to load adapter ${file}:`, error);
    }
  }

  console.log(
    `Loaded ${adapters.size} adapters: ${[...adapters.keys()].join(", ")}`,
  );
}

export function getAdapter(appName: string): AppAdapter | undefined {
  return adapters.get(appName);
}

export function getAllAdapters(): AppAdapter[] {
  return [...adapters.values()];
}
