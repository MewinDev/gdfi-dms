import { expect, test, type Page } from "@playwright/test";
import { signInWith, SUPERADMIN, type TestUser } from "./helpers";

/**
 * Role by screen (piece 12, D-055): each phase A role signs in, sees its own menu, and a page it may not use is
 * "not found" even by typing the address (DP: Settings opens for its "See expense kinds" tick). The menu is read from the server's list (every Main navigation, the
 * rail and the phone's bar alike), so the check holds at every width.
 */
async function menu(page: Page): Promise<string[]> {
  await page.goto("/dashboard");
  const hrefs = await page.locator('nav[aria-label="Main"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  return [...new Set(hrefs)];
}

/** Refused: 404, or (a page with a loading screen streams before it can refuse) the Not found page with status 200. */
async function refused(page: Page, href: string, who: string) {
  const status = (await page.goto(href))?.status();
  if (status === 404) return;
  await expect(page.getByRole("heading", { name: "Not found" }), `${who} opening ${href} (status ${status})`).toBeVisible();
}

const ROLES: { name: string; who: TestUser; has: string[]; lacks: string[]; notFound: string[] }[] = [
  { name: "Loan Associate", who: "Continue as Loan Associate", has: ["/inbox", "/loans"], lacks: ["/jobs", "/funds", "/my-funds", "/admin/users"], notFound: ["/funds", "/admin/users", "/admin/audit"] },
  { name: "LA Supervisor/Head", who: { other: "Test LA Supervisor (LA Supervisor/Head)" }, has: ["/inbox", "/open-items", "/loans"], lacks: ["/jobs", "/my-funds"], notFound: ["/my-funds"] },
  { name: "Document Processor", who: "Continue as Test Document Processor", has: ["/inbox", "/jobs", "/my-funds"], lacks: ["/loans", "/funds", "/admin/users", "/open-items"], notFound: ["/admin/users", "/funds"] },
  { name: "Finance", who: "Continue as Test Finance", has: ["/inbox", "/funds"], lacks: ["/jobs", "/my-funds", "/admin/users"], notFound: ["/admin/users", "/my-funds"] },
  { name: "Admin", who: "Continue as Admin", has: ["/open-items", "/admin/users", "/admin/settings", "/admin/audit"], lacks: ["/jobs", "/my-funds"], notFound: [] },
  { name: "Superadmin", who: SUPERADMIN, has: ["/admin/users", "/admin/settings", "/admin/audit"], lacks: [], notFound: [] },
];

for (const r of ROLES) {
  test(`${r.name}: its menu, and pages outside it are not found`, async ({ page }) => {
    await signInWith(page, r.who);
    const items = await menu(page);
    for (const h of r.has) expect(items, `${r.name} should have ${h}`).toContain(h);
    for (const h of r.lacks) expect(items, `${r.name} should not have ${h}`).not.toContain(h);
    for (const h of r.notFound) await refused(page, h, r.name);
    // Every page in the menu opens (no 404 or error for the role's own screens).
    for (const h of items) {
      expect((await page.goto(h))?.status(), `${r.name} opening ${h}`).toBeLessThan(400);
      await expect(page.getByRole("heading", { name: "Not found" }), `${r.name} opening ${h}`).toHaveCount(0);
    }
  });
}

test("Superadmin opens the file access log; an LA does not", async ({ page }) => {
  await signInWith(page, SUPERADMIN);
  expect((await page.goto("/admin/audit/files"))?.status()).toBe(200);
  await signInWith(page, "Continue as Loan Associate");
  await refused(page, "/admin/audit/files", "Loan Associate");
});
