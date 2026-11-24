/**
 * Runs once when the server starts (next dev and next start). Checks the environment variables:
 * APP_ENV=production or staging refuses to start on unsafe settings; local only warns. Messages name
 * the variable, never its value. In development, MYLOANS_SYNC_DEV_TIMER=true starts the myloans sync timer
 * (lib/myloans/dev-timer.ts; local only).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnvOrExit } = await import("./lib/env/startup");
  checkEnvOrExit();
  const { startDevTimer } = await import("./lib/myloans/dev-timer");
  startDevTimer();
}
