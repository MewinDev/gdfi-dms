import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, signInWith } from "./helpers";

/**
 * D-062: "See loan amounts" (loans:view_amounts). An LA sees the released amount; a Document Processor (off by
 * default) and an LA with the tick denied do not, and the server does not send it: the loan file, the Loans table,
 * the preview, the PN search card, the page data the browser receives and the suggest API. No export carries it (the
 * PN-search CSV has no amount column). The Open loan file card still says what will be set up (Mortgage) without it.
 */
const PN = "GD1012026901001"; // sample myloans: Refinancing, New, 450,000 (Mortgage)
const AMOUNT = /450,000|450000/;
const KEY = "loans:view_amounts";

test.beforeEach(async () => {
  await resetLoans();
  await db.userPermissionOverride.deleteMany({ where: { key: KEY } });
});
test.afterAll(async () => {
  await db.userPermissionOverride.deleteMany({ where: { key: KEY } });
});

async function openLoan(page: Page) {
  await signIn(page, "la");
  await page.goto(`/search?q=${PN}`);
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
}
/** What the server sends for a page (HTML and the page data), as the signed-in person. */
async function sent(page: Page, url: string): Promise<string> {
  const r = await page.request.get(url);
  expect(r.status(), url).toBe(200);
  return r.text();
}
/** Found in myloans: the full PN in the Loans search (one myloans lookup). */
async function search(page: Page) {
  await page.goto(`/loans?q=${PN}`);
  const main = page.getByRole("main");
  const go = main.getByRole("button", { name: "Search", exact: true });
  if (await go.isVisible()) await go.click();
  return main.locator("[data-myloans-result], [data-find-result], section").filter({ hasText: PN }).first();
}

test("an LA sees the amount: loan file, Loans, preview and search", async ({ page }) => {
  // Before opening: the preview and the search card show it.
  await signIn(page, "la");
  expect(await sent(page, `/loans/preview/${PN}`)).toMatch(AMOUNT);
  const card = await search(page);
  await expect(card).toContainText("Amount released");
  await expect(card).toContainText("₱450,000");

  await openLoan(page);
  await expect(page.locator("[data-loan-header] [data-fact=amount]")).toHaveText(/Amount\s*₱450,000/);
  expect(await sent(page, `/loans/${PN}`)).toMatch(AMOUNT);
  expect(await sent(page, "/loans")).toMatch(AMOUNT);
});

test("a Document Processor does not see the amount, and the server does not send it", async ({ page }) => {
  await openLoan(page);
  await signInWith(page, "Continue as Test Document Processor");
  // The loan file: no Amount in the header or in More loan details; nothing in what the server sends.
  await page.goto(`/loans/${PN}`);
  await expect(page.locator("[data-loan-header]")).toBeVisible();
  await expect(page.locator("[data-fact=amount]")).toHaveCount(0);
  await expect(page.getByText("Amount released")).toHaveCount(0);
  expect(await sent(page, `/loans/${PN}`)).not.toMatch(AMOUNT);
  expect(await sent(page, `/loans/${PN}?tab=todo&tx=NOTARY`)).not.toMatch(AMOUNT);
  // The Loans table and cards: no amount column; sorting by amount falls back to Due.
  await page.goto("/loans");
  await expect(page.getByRole("columnheader", { name: /Released amount/ })).toHaveCount(0);
  expect(await sent(page, "/loans")).not.toMatch(AMOUNT);
  expect(await sent(page, "/loans?sort=amount&dir=desc")).not.toMatch(AMOUNT);
  // The suggest API: never an amount.
  const api = await page.request.get(`/api/loans/suggest?q=${PN.slice(0, 8)}`);
  expect(api.status()).toBe(200);
  expect(await api.text()).not.toMatch(AMOUNT);
});

test("an LA with the tick denied: no amount on the preview or the search card; what will be set up still shows", async ({ page }) => {
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  await db.userPermissionOverride.create({ data: { userId: la.id, key: KEY, effect: "DENY", note: "e2e: D-062" } });
  await signIn(page, "la");
  // The preview page (myloans' copy).
  await page.goto(`/loans/preview/${PN}`);
  await expect(page.locator(`[data-loan-preview="${PN}"]`)).toBeVisible();
  await expect(page.getByText("Amount released")).toHaveCount(0);
  expect(await sent(page, `/loans/preview/${PN}`)).not.toMatch(AMOUNT);
  // Found in myloans: no amount, but the rules' result (from the server) still says what will be set up.
  const card = await search(page);
  await expect(card).toContainText(PN);
  await expect(card).not.toContainText("Amount released");
  await expect(page.getByText(/What will be set up/)).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Mortgage");
  expect(await sent(page, `/loans?q=${PN}`)).not.toMatch(AMOUNT);
  // Opening still works (the server runs the rules with the amount): Mortgage is one of the transactions.
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
  await expect(page.locator("[data-fact=amount]")).toHaveCount(0);
  await expect(page.locator("[data-txn-row=MORTGAGE], [data-txn=MORTGAGE]").first()).toBeVisible();
});

test("no export carries the loan amount: the PN-search CSV has no amount column", async ({ page }) => {
  test.skip(page.viewportSize()!.width !== 1440, "Data only: one width is enough.");
  await openLoan(page);
  await signIn(page, "admin");
  const r = await page.request.get("/api/reports/pn-searches");
  expect(r.status()).toBe(200);
  const csv = await r.text();
  expect(csv.split("\n")[0]).not.toMatch(/amount/i);
  expect(csv).not.toMatch(AMOUNT);
});
