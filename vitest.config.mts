import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL(".", import.meta.url));
const read = (f: string) => (existsSync(f) ? (parseEnv(readFileSync(f, "utf8")) as Record<string, string>) : {});
// Same order as Next.js: .env.local wins over .env. Tests always run as APP_ENV=local, and the
// Microsoft Graph values are blanked so no test can send a real email (tests that need them set fakes).
const dotenv = {
  ...read(".env"),
  ...read(".env.local"),
  APP_ENV: "local",
  GRAPH_CLIENT_ID: "",
  GRAPH_CLIENT_SECRET: "",
  GRAPH_TENANT_ID: "",
  GRAPH_SENDER_EMAIL: "",
};

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // Lets service modules ("server-only") load in tests.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    env: dotenv,
    // Integration tests share the local database: run files one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
