import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./lib/env/load-files";

const root = fileURLToPath(new URL(".", import.meta.url));
// Same order as everywhere: a variable set in the shell wins, then .env.local, then .env. (The values
// passed here are written into each test worker, so the shell's value must be kept, not a file's.)
// Tests always run as APP_ENV=local, and the Microsoft Graph values are blanked so no test can send a
// real email (tests that need them set fakes).
const fromFiles: Record<string, string | undefined> = {};
loadEnvFiles([".env.local", ".env"], fromFiles);
const shellFirst = Object.fromEntries(Object.keys(fromFiles).map((k) => [k, process.env[k] ?? fromFiles[k] ?? ""]));
const dotenv = {
  ...shellFirst,
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
