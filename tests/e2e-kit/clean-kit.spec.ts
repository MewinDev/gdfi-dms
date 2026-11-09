import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * The CLEAN Manual Test Kit in the browser (playwright.kit.config.ts, against the person's own server on
 * gdfi_dms with the clean kit loaded: npm run kit:start). Three accounts from the sign-in list each find
 * a PN of the tester sheet and open it: it opens as a fresh loan file, with only what rules 1 to 4 make
 * on opening. It WRITES to gdfi_dms (three loan files per width and the sign-in rows): run npm run
 * kit:reset afterwards. Each width opens its own PNs, so the widths can run one after the other.
 * Screenshots go to docs/screenshots/test-kit/.
 */
const DIR = "docs/screenshots/test-kit";
mkdirSync(DIR, { recursive: true });
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const shot = (page: Page, name: string) => page.screenshot({ path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });

/** Per width: three accounts and the PN each one opens (Refinancing loans: no choices when opening). */
const PLAN: Record<number, [string, string][]> = {
  1440: [["LA Antipolo", "GD1012026903001"], ["LA Angono", "GD1652026903012"], ["Roving LA", "GD1682026903020"]],
  820: [["LA Antipolo", "GD1012026903004"], ["LA Angono", "GD1652026903019"], ["Roving LA", "GD1682026903021"]],
  390: [["LA Antipolo", "GD1012026903005"], ["LA Angono", "GD1652026903013"], ["Roving LA", "GD3902026903026"]],
};

async function signInAs(page: Page, name: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("[data-kit-accounts]").getByRole("button", { name: new RegExp(`^Continue as ${name}\\b`) }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.beforeAll(async ({ request }) => {
  const html = await (await request.get("/login")).text();
  if (!html.includes("Continue as LA Antipolo")) throw new Error("The clean kit is not loaded on this server. Run npm run kit:start and point KIT_BASE_URL at the gdfi_dms server.");
});

test("sign-in list: grouped by role, the branches under each name, the inactive LA not listed", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/login");
  const list = page.locator("[data-kit-accounts]");
  await expect(list.locator('[data-kit-role="Loan Associate"]').getByRole("button", { name: /^Continue as LA Antipolo\b/ })).toContainText("Antipolo");
  await expect(list.getByRole("button", { name: /^Continue as Roving LA\b/ })).toContainText("All branches");
  await expect(list.getByRole("button", { name: /LA Inactive/ })).toHaveCount(0);
  await shot(page, "clean-sign-in-list");
});

for (const i of [0, 1, 2]) {
  test(`account ${i + 1}: finds a PN and opens it as a fresh loan file`, async ({ page }) => {
    const [who, pn] = PLAN[width(page)][i];
    await signInAs(page, who);
    await page.goto(`/loans?fill=${pn}`);
    const main = page.getByRole("main");
    await main.getByRole("button", { name: /^Find/ }).click();
    await main.getByRole("button", { name: "Open loan file" }).click();
    await expect(page).toHaveURL(new RegExp(`/loans/${pn}`));
    await expect(main).toContainText(pn);
    // Fresh: nothing sent, on hold, missing or funded; no Journey steps after opening.
    for (const word of [/Sent to/, /On hold/, /Missing paper/, /Funded/]) await expect(main.getByText(word)).toHaveCount(0);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over).toBeLessThanOrEqual(0);
    await shot(page, `clean-opened-${i + 1}`);
  });
}
