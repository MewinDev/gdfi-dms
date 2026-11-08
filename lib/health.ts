import { readFileSync } from "node:fs";
import path from "node:path";
import pkg from "@/package.json";
import { appEnv, type AppEnv } from "@/lib/env";

/**
 * GET /api/health for the host's health check: no sign-in, no data, no variable names or values.
 * ok is false (HTTP 503) when the database does not answer within the time limit.
 */
export interface Health { ok: boolean; environment: AppEnv; database: "up" | "down"; version: string; build: string | null }

let buildId: string | null | undefined;
function readBuildId(): string | null {
  if (buildId !== undefined) return buildId;
  try {
    buildId = readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim().slice(0, 32) || null;
  } catch {
    buildId = null; // next dev has no build id
  }
  return buildId;
}

export async function health(ping: () => Promise<unknown>, timeoutMs = 2000): Promise<Health> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const up = await Promise.race([
    ping().then(() => true, () => false),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
  ]);
  clearTimeout(timer);
  return { ok: up, environment: appEnv(), database: up ? "up" : "down", version: pkg.version, build: readBuildId() };
}
