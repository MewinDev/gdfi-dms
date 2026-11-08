/**
 * Runs once when the server starts (next dev and next start). Checks the environment variables:
 * APP_ENV=production or staging refuses to start on unsafe settings; local only warns. Messages name
 * the variable, never its value.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnvOrExit } = await import("./lib/env/startup");
  checkEnvOrExit();
}
