import { expect, test, type Page } from "@playwright/test";
import { cleanTestRoles, db, resetLoans } from "./db";
import { signIn, visibleSearchBox, watchConsole } from "./helpers";

/**
 * My loans, compact and minimalist: title only, one 40px toolbar (Find loan inside the box, Filters beside it),
 * the samples in one closed row (test mode), underline tabs with counts, "Showing X of Y" only with a filter or a
 * search, one list block with aligned columns (Borrower, Loan, Next step, Due, Open), calm empty lines.
 * Screenshots at 1440, 820 and 390: docs/screenshots/my-loans-compact/.
 */
const DIR = "docs/screenshots/my-loans-compact";
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.getByRole("main");
const tabs = (page: Page) => main(page).getByRole("navigation", { name: "Loan lists" });
const rows = (page: Page) => main(page).locator("[data-loan-row]");

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

let n = 0;
const NAMES = ["Ana Villanueva", "Ramon Garcia", "Liza Torres", "Mario Reyes", "Nora Santos", "Pedro Cruz", "Gina Lopez", "Tess Ramos", "Carlo Diaz", "Rosa Lim", "Joel Tan", "Mila Cruz"];
async function loan(name: string, opts: { loanType?: string; stage?: string; problem?: boolean } = {}) {
  const angono = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  n += 1;
  const l = await db.loan.create({
    data: {
      pn: `GD1652026907${String(700 + n).padStart(3, "0")}`, borrowerName: name, branchId: angono.id, loanType: opts.loanType ?? "New", productName: "Auto Refinancing",
      totalReleasedAmount: 400000 + n * 1000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: la.id,
      classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "MORTGAGE_THRESHOLD:New:MET", stage: opts.stage ?? "For checklist",
    },
  });
  if (opts.problem) await db.loanException.create({ data: { loanId: l.id, type: "OTHER", reason: "Wrong plate number", raisedByLabel: "E2E" } });
  return l;
}

test.beforeEach(async () => {
  await resetLoans();
  await cleanTestRoles();
  n = 0;
});
test.afterAll(async () => {
  await resetLoans();
});

test("LA with one loan: title only, one toolbar (Find loan once), samples closed, underline tabs, one compact row", async ({ page }) => {
  const clean = watchConsole(page);
  await loan("Ana Villanueva");
  await signIn(page, "la");
  await page.goto("/loans");
  await expect(main(page).getByRole("heading", { level: 1, name: "My loans" })).toBeVisible();
  await expect(main(page).getByText("Find a loan by its number")).toHaveCount(0); // no subtitle
  await expect(main(page).getByRole("button", { name: "Find loan" })).toHaveCount(1);
  // One 40px toolbar row.
  const bar = main(page).locator("[data-loans-toolbar]");
  expect(Math.round((await bar.boundingBox())!.height)).toBeLessThanOrEqual(44);
  await expect(visibleSearchBox(page)).toHaveAttribute("placeholder", "PN, borrower name, CIN or CIF");
  // Samples: one closed row.
  const samples = main(page).locator("[data-home-samples]").first();
  await expect(samples).not.toHaveAttribute("open", "");
  // Tabs: labels, order, counts; no "Showing" line without a filter.
  await expect(tabs(page).getByRole("link")).toHaveText([/^My queue\s*1$/, /^All branch loans\s*1$/, /^Problems\s*0$/, /^Archived\s*0$/]);
  await expect(tabs(page).getByRole("link", { name: /^My queue/ })).toHaveAttribute("aria-current", "page");
  expect(await tabs(page).getByRole("link", { name: /^My queue/ }).evaluate((e) => getComputedStyle(e).borderBottomWidth)).toBe("2px");
  await expect(main(page).locator("[data-showing]")).toHaveCount(0);
  await expect(main(page).getByText(/Showing \d+ loan file/)).toHaveCount(0);
  // One block, one row, no header row under five rows.
  await expect(main(page).locator("[data-loan-list]")).toHaveCount(1);
  await expect(rows(page)).toHaveCount(1);
  await expect(main(page).locator("[data-list-head]")).toHaveCount(0);
  const row = rows(page).first();
  await expect(row).toContainText("Ana Villanueva");
  await expect(row).toContainText("GD1652026907701 · Angono");
  await expect(row).toContainText("₱401,000");
  await expect(row).toContainText("New · Auto Refinancing");
  await expect(row).toContainText("Check documents");
  // The Next step text (stage map) may take two lines: about 70px a row.
  if (width(page) >= 640) expect((await row.boundingBox())!.height).toBeLessThanOrEqual(76);
  else expect((await row.boundingBox())!.height).toBeLessThanOrEqual(80); // three short lines
  await noSideways(page);
  await shot(page, "la-one-loan");
  clean();
});

test("LA with twelve loans: header row, aligned columns, seven rows in view at 1440; a filter shows its chip and Showing X of Y", async ({ page }) => {
  const clean = watchConsole(page);
  for (let i = 0; i < 12; i++) await loan(NAMES[i], { loanType: i < 4 ? "Renewal" : "New" });
  await signIn(page, "la");
  await page.goto("/loans?tab=all");
  await expect(rows(page)).toHaveCount(12);
  await expect(main(page).locator("[data-list-head]")).toBeVisible().catch(async () => {
    if (width(page) >= 640) throw new Error("the header row should show from five rows");
  });
  if (width(page) >= 640) {
    // The step column starts at the same x on every row.
    const xs = await rows(page).locator("[data-step]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(xs).size).toBe(1);
  }
  if (width(page) === 1440) {
    // Seven rows in view at 1440 (the Next step text may take two lines).
    expect(await rows(page).nth(6).evaluate((e) => e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(900);
  }
  await noSideways(page);

  // A filter: its chip under the toolbar, a count on the Filters button, "Showing 4 of 12".
  await page.goto("/loans?tab=all&loanType=Renewal");
  await expect(rows(page)).toHaveCount(4);
  await expect(main(page).locator("[data-filter-chips]").getByRole("link", { name: "Remove filter Loan type: Renewal" })).toBeVisible();
  await expect(main(page).getByRole("button", { name: "Filters, 1 on" })).toBeVisible();
  await expect(main(page).locator("[data-showing]")).toHaveText("Showing 4 of 12");
  await shot(page, "la-twelve-filter");
  // Removing the chip clears it.
  await main(page).locator("[data-filter-chips]").getByRole("link", { name: "Clear all" }).click();
  await expect(page).not.toHaveURL(/loanType=/);
  await expect(main(page).locator("[data-filter-chips]")).toHaveCount(0);
  await expect(main(page).locator("[data-showing]")).toHaveCount(0);
  clean();
});

test("empty tabs: one calm line each, no card", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  for (const [tab, text] of [["queue", "You're all caught up."], ["all", "No loan files in your branches yet."], ["exceptions", "No problems."], ["archived", "Nothing archived."]] as const) {
    await page.goto(`/loans?tab=${tab}`);
    await expect(main(page).locator("[data-empty-line]")).toContainText(text);
    await expect(main(page).locator("[data-loan-list]")).toHaveCount(0);
    if (tab === "queue") await shot(page, "la-empty-queue");
    if (tab === "exceptions") await shot(page, "problems-none");
  }
  await page.goto("/loans?tab=all&loanType=Renewal");
  await expect(main(page).locator("[data-empty-line]")).toContainText("No loans match.");
  await expect(main(page).getByRole("link", { name: "Clear filters" })).toBeVisible();
  await noSideways(page);
  clean();
});

test("Problems tab with items; the flag chip stays", async ({ page }) => {
  const clean = watchConsole(page);
  await loan("Ana Villanueva", { problem: true });
  await loan("Ramon Garcia");
  await signIn(page, "la");
  await page.goto("/loans?tab=exceptions");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator("[data-flags]")).toContainText("1 problem");
  await expect(rows(page).first()).toContainText("Fix a problem first");
  await noSideways(page);
  await shot(page, "problems-items");
  clean();
});

test("test mode: Sample loans closed by default, open shows one line each; a pick fills the box", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/loans");
  const samples = main(page).locator("[data-home-samples]").first();
  await expect(samples.getByRole("button", { name: /^GD/ }).first()).toBeHidden();
  await shot(page, "samples-closed");
  await samples.locator("summary").click();
  const first = samples.getByRole("button", { name: /^GD/ }).first();
  await expect(first).toBeVisible();
  expect((await first.boundingBox())!.height).toBeLessThan(48);
  await shot(page, "samples-open");
  const pn = ((await first.textContent()) ?? "").match(/GD\d{13}/)![0];
  await first.click();
  await expect(visibleSearchBox(page)).toHaveValue(pn);
  clean();
});

test("the search dropdown: compact rows (name, PN · branch), saved loans only", async ({ page }) => {
  const clean = watchConsole(page);
  for (let i = 0; i < 3; i++) await loan(NAMES[i]);
  await signIn(page, "la");
  await page.goto("/loans");
  await visibleSearchBox(page).fill("GD16520269077");
  const panel = page.locator("[data-find-results]");
  await expect(panel.locator("[data-find-hit]")).toHaveCount(3);
  const hit = panel.locator("[data-find-hit]").first();
  await expect(hit).toContainText("· Angono");
  expect((await hit.boundingBox())!.height).toBeLessThanOrEqual(40);
  await noSideways(page);
  await shot(page, "search-dropdown");
  clean();
});

test("Admin: the read-only list has its own columns (Branch too, no Classification), the same tabs and toolbar", async ({ page }) => {
  const clean = watchConsole(page);
  for (let i = 0; i < 6; i++) await loan(NAMES[i]);
  await signIn(page, "admin");
  await page.goto("/loans?tab=all");
  await expect(main(page).getByRole("heading", { level: 1, name: "Loans" })).toBeVisible();
  await expect(tabs(page).getByRole("link")).toHaveText([/^Needs action/, /^All loans\s*6$/, /^Exceptions/, /^Archived/]);
  if (width(page) >= 640) {
    // One column per fact (no Classification); Released and Amount from 1024px (under the product below it).
    for (const h of ["Borrower", "Product", "Stage", "TAT", "Next step", ...(width(page) >= 1024 ? ["Branch", "Released", "Amount"] : [])]) {
      await expect(main(page).getByRole("columnheader", { name: h, exact: true })).toBeVisible();
    }
    await expect(main(page).getByRole("columnheader", { name: "Classification" })).toHaveCount(0);
  } else {
    await expect(main(page).getByRole("list", { name: "Loan files" }).getByRole("listitem")).toHaveCount(6);
  }
  await noSideways(page);
  await shot(page, "admin-branch-column");
  clean();
});
