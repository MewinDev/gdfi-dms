import { expect, test, type Page } from "@playwright/test";
import { cleanTestRoles, db, resetLoans } from "./db";
import { signIn, watchConsole } from "./helpers";

/**
 * The stage map (phase 1, display only; lib/workflow/stage-map.ts): the loan-file stepper's new step names
 * and current step, and the Next step texts on My loans with their "Waiting for: …" tooltip.
 * Screenshots at 1440, 820 and 390: docs/screenshots/stage-map/ (the Loans table one is in loans-table.spec.ts).
 */
const DIR = "docs/screenshots/stage-map";
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.getByRole("main");
const STEPS = ["Loan opened", "Classified", "Check documents", "DP Processing", "LA Acceptance", "Collateral", "Quality Assurance", "Digital Records", "In Safekeeping", "Closure"];

async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

let n = 0;
async function loan(name: string, stage: string) {
  const angono = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  n += 1;
  const closed = stage === "Closed" ? new Date() : null;
  return db.loan.create({
    data: {
      pn: `GD1652026905${String(500 + n).padStart(3, "0")}`, borrowerName: name, branchId: angono.id, loanType: "New", productName: "Auto Refinancing",
      totalReleasedAmount: 500000 + n * 1000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: la.id,
      classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "MORTGAGE_THRESHOLD:New:MET", stage, closedAt: closed,
    },
  });
}

test.beforeEach(async () => {
  await resetLoans();
  await cleanTestRoles();
  n = 0;
});
test.afterAll(async () => {
  await resetLoans();
});

test("the loan-file stepper: the 10 new step names, the current step from the stage, no sideways scroll", async ({ page }) => {
  const clean = watchConsole(page);
  const l = await loan("Ana Villanueva", "For checklist");
  await signIn(page, "admin");
  for (const [stage, step] of [["For checklist", 3], ["In process", 4], ["For Vault Transmittal", 6], ["Closed", 10]] as const) {
    await db.loan.update({ where: { id: l.id }, data: { stage, closedAt: stage === "Closed" ? new Date() : null } });
    await page.goto(`/loans/${l.pn}`);
    const progress = page.getByRole("region", { name: "Progress" });
    await expect(progress).toHaveAttribute("data-current-step", String(step));
    if (width(page) >= 1024) {
      // Every name, in order; the current one is the stage's step; the ones before it are done.
      await expect(progress.locator("[data-step-name]")).toHaveCount(10);
      for (const [i, name] of STEPS.entries()) await expect(progress.locator("[data-step-name]").nth(i)).toHaveAttribute("data-step-name", name);
      await expect(progress.locator('[data-step-name][aria-current="step"]')).toContainText(STEPS[step - 1]);
      await expect(progress.getByRole("img").nth(step - 2)).toHaveAccessibleName(/Done\.$/);
      if (step < 10) await expect(progress.getByRole("img").nth(step)).toHaveAccessibleName(/Later\.$/);
      // Each name fully visible (two lines at most, nothing cut).
      const cut = await progress.locator("[data-step-name] > span[aria-hidden]").evaluateAll((els) => els.filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
      expect(cut).toEqual([]);
    } else {
      // Under 1024px: only the current step's name, "Step 6 of 10 · Collateral"; the sheet lists all 10.
      await expect(progress).toContainText(`Step ${step} of 10 · ${STEPS[step - 1]}`);
      if (step === 3) {
        await progress.getByRole("button", { name: /Step 3 of 10/ }).click();
        const sheet = page.getByRole("dialog", { name: "All 10 steps" });
        for (const [i, name] of STEPS.entries()) await expect(sheet.getByRole("listitem").nth(i)).toContainText(name);
        await page.keyboard.press("Escape");
      }
    }
    await noSideways(page);
    await page.evaluate(() => document.fonts.ready);
    await progress.screenshot({ path: `${DIR}/stepper-step-${step}-${width(page)}.png` });
  }
  clean();
});

test("My loans: the Next step column shows the stage map's text with its tooltip", async ({ page }) => {
  const clean = watchConsole(page);
  const want: [string, string, string, string | null][] = [
    ["Ana Villanueva", "For checklist", "Check documents, then assign to DP", "Waiting for: Loan Associate"],
    ["Liza Torres", "Assigned to DP", "DP accepts the assignment", "Waiting for: Document Processor / Collateral & Mortgage"],
    ["Nora Santos", "Awaiting LA acceptance", "LA accepts the package", "Waiting for: Loan Associate (receiving branch)"],
    ["Pedro Cruz", "For Vault Transmittal", "Create the transmittal", "Waiting for: Loan Associate"],
    ["Ramon Garcia", "Opened", "System sets up the transactions", null],
  ];
  for (const [name, stage] of want) await loan(name, stage);
  await signIn(page, "la");
  await page.goto("/loans?tab=all");
  const rows = main(page).locator("[data-loan-row]");
  await expect(rows).toHaveCount(want.length);
  for (const [name, , next, tip] of want) {
    const row = rows.filter({ hasText: name });
    if (width(page) >= 640) {
      const cell = row.locator("[data-next-text]");
      await expect(cell).toHaveText(next);
      if (tip) await expect(cell).toHaveAttribute("title", tip);
      else expect(await cell.getAttribute("title"), name).toBeNull();
    } else await expect(row).toContainText(next);
  }
  await noSideways(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${DIR}/my-loans-${width(page)}.png`, fullPage: true });
  clean();
});

/**
 * The fix after the Monitoring of Documents review: step 9 is "In Safekeeping" (a normal stage again), step 10
 * "Closure". Screenshots at 1440, 820 and 390: docs/screenshots/stage-map-fix/.
 */
const FIX_DIR = "docs/screenshots/stage-map-fix";

test("fix: the stepper at steps 6, 9 and 10 (In Safekeeping, Closure), no sideways scroll", async ({ page }) => {
  const clean = watchConsole(page);
  const l = await loan("Ana Villanueva", "For Vault Transmittal");
  await signIn(page, "admin");
  for (const [stage, step] of [["For Vault Transmittal", 6], ["In Safekeeping", 9], ["Closed", 10]] as const) {
    await db.loan.update({ where: { id: l.id }, data: { stage, closedAt: stage === "Closed" ? new Date() : null } });
    await page.goto(`/loans/${l.pn}`);
    const progress = page.getByRole("region", { name: "Progress" });
    await expect(progress).toHaveAttribute("data-current-step", String(step));
    if (width(page) >= 1024) {
      await expect(progress.locator("[data-step-name]").nth(8)).toHaveAttribute("data-step-name", "In Safekeeping");
      await expect(progress.locator("[data-step-name]").nth(9)).toHaveAttribute("data-step-name", "Closure");
      await expect(progress.locator('[data-step-name][aria-current="step"]')).toContainText(STEPS[step - 1]);
      await expect(progress.getByRole("img").nth(8)).toHaveAccessibleName(step > 9 ? /^In Safekeeping\. Collateral\. Done\.$/ : step === 9 ? /^In Safekeeping\. Collateral\. Now\.$/ : /^In Safekeeping\. Collateral\. Later\.$/);
      // No old step 9 name.
      await expect(progress).not.toContainText("Archival");
    } else {
      await expect(progress).toContainText(`Step ${step} of 10 · ${STEPS[step - 1]}`);
    }
    await noSideways(page);
    await page.evaluate(() => document.fonts.ready);
    await progress.screenshot({ path: `${FIX_DIR}/stepper-step-${step}-${width(page)}.png` });
  }
  clean();
});

test("fix: the Loans table shows 'In safekeeping' for a loan in that stage", async ({ page }) => {
  const clean = watchConsole(page);
  await loan("Tess Ramos", "In Safekeeping");
  await loan("Pedro Cruz", "For Vault Transmittal");
  await loan("Gina Lopez", "In transit to Vault");
  await signIn(page, "admin");
  await page.goto("/loans?tab=all");
  const rows = main(page).locator("[data-loan-row]:visible");
  await expect(rows).toHaveCount(3);
  const row = rows.filter({ hasText: "Tess Ramos" });
  await expect(row.locator("[data-stage-name]")).toHaveText("In safekeeping");
  await expect(row).toContainText("Kept in the vault until the loan is fully paid");
  if (width(page) >= 1024) await expect(row.locator("[data-stage-name]")).toHaveAttribute("data-stage-step", "9");
  await expect(rows.filter({ hasText: "Gina Lopez" }).locator("[data-stage-name]")).toHaveText("Receiving");
  await noSideways(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${FIX_DIR}/loans-table-in-safekeeping-${width(page)}.png`, fullPage: true });
  clean();
});
