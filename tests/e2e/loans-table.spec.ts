import { expect, test, type Page } from "@playwright/test";
import { cleanTestRoles, db, resetLoans } from "./db";
import { watchConsole } from "./helpers";

/**
 * The Loans table (the read-only list: Admin, Supervisor, approvers, Finance, processors): one column per fact,
 * Borrower (name, PN under it), Branch, Product (product name, loan type under it), Released, Amount, Stage
 * (the stage's name from the stage map), TAT (a small chip with the date), Next step (the stage map's text, its
 * owner in a tooltip; none for the system). No Classification. Screenshots: docs/screenshots/loans-table/.
 */
const DIR = "docs/screenshots/loans-table";
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.getByRole("main");
const rows = (page: Page) => main(page).locator("[data-loan-row]:visible");
const BUTTONS = { admin: "Continue as Admin", dp: "Continue as Test Document Processor" } as const;

async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

let n = 0;
async function loan(name: string, opts: { stage?: string; branch?: string; loanType?: string; product?: string; problem?: boolean } = {}) {
  const branch = await db.branch.findUniqueOrThrow({ where: { code: opts.branch ?? "165" } });
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  n += 1;
  const l = await db.loan.create({
    data: {
      pn: `GD${opts.branch ?? "165"}2026906${String(600 + n).padStart(3, "0")}`, borrowerName: name, branchId: branch.id, loanType: opts.loanType ?? "New",
      productName: opts.product ?? "Auto Refinancing", totalReleasedAmount: 1_000_000 + n * 1000, releasedAt: new Date("2026-11-10T02:00:00Z"),
      sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: la.id, classification: "REFINANCING", mortgageResult: "MORTGAGE",
      ruleFired: "MORTGAGE_THRESHOLD:New:MET", stage: opts.stage ?? "For checklist",
    },
  });
  if (opts.problem) await db.loanException.create({ data: { loanId: l.id, type: "OTHER", reason: "Wrong plate number", raisedByLabel: "E2E" } });
  return l;
}
/** Twelve loans across the flow and two branches. */
async function twelve() {
  const stages: [string, string][] = [
    ["Ana Villanueva", "For checklist"], ["Ramon Garcia", "Opened"], ["Liza Torres", "Assigned to DP"], ["Mario Reyes", "In process"],
    ["Nora Santos", "Awaiting LA acceptance"], ["Pedro Cruz", "For Vault Transmittal"], ["Gina Lopez", "In transit to Vault"], ["Tess Ramos", "In Safekeeping"],
    ["Carlo Diaz", "Closed"], ["Rosa Lim", "Cancelled in MyLoans"], ["Joel Tan", "No DP assignment required"], ["Mila Cruz", "For checklist"],
  ];
  for (const [i, [name, stage]] of stages.entries()) await loan(name, { stage, branch: i % 2 ? "101" : "165", loanType: i % 3 ? "New" : "Renewal" });
}

test.beforeEach(async () => {
  await resetLoans();
  await cleanTestRoles();
  n = 0;
});
test.afterAll(async () => {
  await resetLoans();
});

test("one loan: one column per fact (no Classification); the stage name is the loan file's; TAT with its date; next step only", async ({ page }) => {
  const clean = watchConsole(page);
  const l = await loan("Ana Villanueva", { product: "Auto Financing", loanType: "Renewal" });
  await signInAs(page, "admin");
  await page.goto("/loans?tab=all");
  const row = rows(page).first();
  if (width(page) >= 640) {
    const heads = await main(page).getByRole("columnheader").allInnerTexts();
    expect(heads.map((h) => h.trim()).filter(Boolean)).toEqual(width(page) >= 1024
      ? ["Borrower", "Branch", "Product", "Released", "Amount", "Stage", "TAT", "Next step"]
      : ["Borrower", "Product", "Stage", "TAT", "Next step"]);
    await expect(main(page).getByRole("columnheader", { name: "Classification" })).toHaveCount(0);
    await expect(main(page).locator("[data-loan-table]").getByText(/^(Refinancing|Financing)$/)).toHaveCount(0);
    // Borrower: the name, the PN under it.
    const b = row.locator('[data-col="borrower"]');
    await expect(b.getByRole("link")).toHaveText(/^Ana Villanueva/);
    await expect(b).toContainText(l.pn);
    if (width(page) >= 1024) await expect(row.locator('[data-col="branch"]')).toHaveText("Angono");
    else await expect(b).toContainText(`${l.pn} · Angono`);
    await expect(row.locator('[data-col="product"]')).toContainText("Auto Financing");
    await expect(row.locator('[data-col="product"]')).toContainText("Renewal");
    if (width(page) >= 1024) {
      await expect(row.locator('[data-col="released"]')).toHaveText("Nov 10, 2026");
      await expect(row.locator('[data-col="amount"]')).toHaveText("₱1,001,000");
    } else await expect(row.locator('[data-col="product"]')).toContainText("Nov 10, 2026 · ₱1,001,000");
    // Next step: the step text only; its owner in a tooltip.
    const next = row.locator("[data-next-step]");
    await expect(next).toHaveText("Check documents, then assign to DP");
    await expect(next).toHaveAttribute("title", "Waiting for: Loan Associate");
    await expect(next.locator(".chip")).toHaveCount(0);
  } else {
    await expect(row).toContainText("Ana Villanueva");
    await expect(row).toContainText(`${l.pn} · Angono`);
    await expect(row).toContainText("Auto Financing · Renewal · Nov 10, 2026 · ₱1,001,000");
  }
  // Stage: the stage map's name.
  await expect(row.locator("[data-stage-name]")).toHaveText("Check documents");
  await expect(row.locator("[data-stage-dots]")).toHaveCount(0);
  // TAT: a small chip or grey text, with the deadline date.
  await expect(row.locator("[data-tat-text]")).toHaveText(/ · [A-Z][a-z]{2} \d{1,2}$/);
  await noSideways(page);
  await shot(page, "admin-one-loan");

  // The row opens the loan file (the same target); its stepper says the same step.
  await row.click(); // the whole row opens the loan file
  await expect(page).toHaveURL(new RegExp(`/loans/${l.pn}`));
  const progress = page.getByRole("region", { name: "Progress" });
  if (width(page) >= 1024) await expect(progress.locator('[aria-current="step"]:visible')).toContainText("Check documents");
  else await expect(progress).toContainText("Step 3 of 10 · Check documents");
  clean();
});

/** The stage map's Stage column, Next step and tooltip for the twelve loans (lib/workflow/stage-map.ts). */
const TWELVE: [string, string, string, string | null][] = [
  ["Ana Villanueva", "Check documents", "Check documents, then assign to DP", "Waiting for: Loan Associate"],
  ["Ramon Garcia", "Check documents", "System sets up the transactions", null],
  ["Liza Torres", "DP Assigning", "DP accepts the assignment", "Waiting for: Document Processor / Collateral & Mortgage"],
  ["Mario Reyes", "LTO Processing", "DP processes the transactions", "Waiting for: Document Processor / Collateral & Mortgage"],
  ["Nora Santos", "Forwarding to LA branch", "LA accepts the package", "Waiting for: Loan Associate (receiving branch)"],
  ["Pedro Cruz", "For transmittal", "Create the transmittal", "Waiting for: Loan Associate"],
  ["Gina Lopez", "Receiving", "Collateral receives by scan", "Waiting for: Collateral"],
  ["Tess Ramos", "In safekeeping", "Kept in the vault until the loan is fully paid", "Waiting for: Collateral"],
  ["Carlo Diaz", "Closed", "Records archives the file", "Waiting for: Records"],
  ["Rosa Lim", "Cancelled in MyLoans", "No further steps", null],
  ["Joel Tan", "Check documents (LA only)", "Complete the LA-only transactions", "Waiting for: Loan Associate"],
];

test("twelve loans across the flow: the stage map's Stage and Next step texts, grey for cancelled; grouped by area", async ({ page }) => {
  const clean = watchConsole(page);
  await twelve();
  await signInAs(page, "admin");
  await page.goto("/loans?tab=all");
  await expect(rows(page)).toHaveCount(12);
  const stageOf = async (name: string) => (await rows(page).filter({ hasText: name }).locator("[data-stage-name], [data-stage-word]").textContent())?.trim();
  for (const [name, stage, next, tip] of TWELVE) {
    expect(await stageOf(name), name).toBe(stage);
    const row = rows(page).filter({ hasText: name });
    if (width(page) >= 640) {
      const cell = row.locator("[data-next-step]");
      await expect(cell).toHaveText(next);
      if (tip) await expect(cell).toHaveAttribute("title", tip);
      else expect(await cell.getAttribute("title"), name).toBeNull();
    } else await expect(row).toContainText(next);
  }
  // Cancelled: its word in grey (no step).
  await expect(rows(page).filter({ hasText: "Rosa Lim" }).locator("[data-stage-word]")).toHaveText("Cancelled in MyLoans");
  for (const old of ["Your acceptance", "Acceptance", "Processing", "Vault", "DigiCur", "Pull-out", "QA review", "SYS"]) await expect(main(page).getByText(old, { exact: true })).toHaveCount(0);
  if (width(page) === 1440) expect(await rows(page).nth(7).evaluate((e) => e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(900);
  await noSideways(page);
  await shot(page, "admin-twelve-stages");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `docs/screenshots/stage-map/loans-table-${width(page)}.png`, fullPage: true });

  // Group by area and branch: the same toggle and headings.
  await main(page).getByRole("link", { name: "Group by area and branch" }).click();
  await expect(page).toHaveURL(/by=area/);
  if (width(page) >= 640) await expect(main(page).locator("[data-loan-branch]").first()).toBeVisible();
  await expect(rows(page)).toHaveCount(12);
  await noSideways(page);
  await shot(page, "grouped-by-area");
  clean();
});

test("a loan with a chip (a problem): the chip after the name; filters and tabs as before", async ({ page }) => {
  const clean = watchConsole(page);
  await loan("Ana Villanueva", { problem: true });
  await loan("Ramon Garcia");
  await signInAs(page, "admin");
  await page.goto("/loans?tab=exceptions");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator("[data-flags]")).toContainText("1 problem");
  await noSideways(page);
  await shot(page, "loan-with-chip");
  // The Classification filter is still there.
  await main(page).getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("dialog", { name: "Filters" }).getByLabel("Classification")).toBeVisible();
  clean();
});

test("a processor's view: the same table for their branches", async ({ page }) => {
  const clean = watchConsole(page);
  await twelve();
  await signInAs(page, "dp");
  await page.goto("/loans?tab=all");
  await expect(main(page).getByRole("heading", { level: 1, name: "Loans" })).toBeVisible();
  await expect(rows(page)).toHaveCount(12); // Angono and Antipolo: both their branches
  await noSideways(page);
  await shot(page, "processor-view");
  clean();
});
