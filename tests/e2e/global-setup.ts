import type { FullConfig } from "@playwright/test";
import { db, resetLoans } from "./db";

/**
 * TEST DATABASE ONLY (gdfi_dms_test): start every run with no loan files. Each test also resets first.
 * First proves the server under test reads the same test database: a one-off test user is added there
 * and must appear on the server's sign-in page. A server on the person's own database (gdfi_dms) never
 * shows it, so the run stops before any test changes anything.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3100";
  const marker = `E2E database check ${Date.now()}`;
  const email = `zz.e2e-check-${Date.now()}@gdfi.ph`;
  const admin = await db.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
  await db.user.create({ data: { email, name: marker, roleId: admin.id, isTestUser: true } });
  try {
    const html = await (await fetch(`${baseURL}/login`)).text();
    if (!html.includes(marker)) {
      throw new Error(`The server at ${baseURL} does not use the test database (gdfi_dms_test). Stop it, or unset E2E_BASE_URL so Playwright starts its own on port 3100.`);
    }
  } finally {
    await db.user.delete({ where: { email } });
  }
  await resetLoans();
  await db.$disconnect();
}
