import { assertEnvAtStartup } from "./index";

/** Server start and console scripts: print the plain refusal (names only) and stop. */
export function checkEnvOrExit(): void {
  try {
    assertEnvAtStartup();
  } catch (e) {
    console.error(e instanceof Error ? e.message : "GDFI DMS will not start: the environment check failed.");
    process.exit(1);
  }
}
