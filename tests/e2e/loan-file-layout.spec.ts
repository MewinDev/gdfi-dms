import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn } from "./helpers";

// The stage map's 10 steps (lib/workflow/stage-map.ts), as the business named them.
const STEPS = ["Loan opened", "Classified", "Check documents", "DP Processing", "LA Acceptance", "Collateral", "Quality Assurance", "Digital Records", "In Safekeeping", "Closure"];
const OLD_NAMES = ["Processing", "Your acceptance", "Vault", "DigiCur", "Pull-out", "QA review"];

test.beforeEach(async () => {
  await resetLoans();
});

async function openLoan(page: Page) {
  await signIn(page, "la");
  await page.goto("/search?q=GD1012026901001");
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/GD1012026901001/);
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

const phone = (page: Page) => page.viewportSize()!.width < 600;
/** The stepper shows only the current step under 1024px (the longer names do not fit a tenth of the width). */
const compactStepper = (page: Page) => page.viewportSize()!.width < 1024;

test("header: breadcrumb above, no boxed Back button beside the title, subtitle directly under the title", async ({ page }) => {
  await openLoan(page);
  const main = page.getByRole("main");
  const title = main.getByRole("heading", { level: 1, name: "Loan File" });
  await expect(title).toBeVisible();
  await expect(main.getByRole("link", { name: /Back to home/ })).toHaveCount(0);
  if (phone(page)) {
    await expect(main.getByRole("link", { name: /My loans/ }).first()).toBeVisible();
  } else {
    const crumbs = main.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(crumbs.getByRole("link", { name: "My loans" })).toBeVisible();
    await expect(crumbs.getByText("GD1012026901001")).toHaveAttribute("aria-current", "page");
  }
  const sub = main.getByText("Maria Santos · GD1012026901001 · Antipolo · ₱450,000 · New");
  const t = (await title.boundingBox())!;
  const s = (await sub.boundingBox())!;
  expect(Math.abs(s.x - t.x)).toBeLessThan(2); // nothing to the left of either
  expect(s.y - (t.y + t.height)).toBeLessThan(12); // directly below
  await noSideScroll(page);

  // Check documents: same pattern.
  await page.getByRole("link", { name: "Start checking" }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Check documents" })).toBeVisible();
  if (!phone(page)) {
    await expect(main.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Home›My loans›GD1012026901001›Check documents");
  }
  await noSideScroll(page);
});

test("progress: all 10 steps, done / now / later, labels not cut; Step 3 of 10 in the Next step card", async ({ page }) => {
  await openLoan(page);
  const progress = page.getByRole("region", { name: "Progress" });
  if (compactStepper(page)) {
    const line = progress.getByRole("button", { name: /Step 3 of 10 · Check documents/ });
    await expect(line).toBeVisible();
    await line.click();
    const sheet = page.getByRole("dialog", { name: "All 10 steps" });
    await expect(sheet.getByRole("listitem")).toHaveCount(10);
    for (const [i, name] of STEPS.entries()) await expect(sheet.getByRole("listitem").nth(i)).toContainText(name);
    await expect(sheet.getByRole("listitem").nth(1)).toContainText("Done");
    await expect(sheet.getByRole("listitem").nth(2)).toContainText("Now");
    await expect(sheet.getByRole("listitem").nth(3)).toContainText("Later");
    await page.keyboard.press("Escape");
  } else {
    const dots = progress.getByRole("img");
    await expect(dots).toHaveCount(10);
    await expect(dots.nth(0)).toHaveAccessibleName("Loan opened. Loan Associate. Done.");
    await expect(dots.nth(1)).toHaveAccessibleName("Classified. Automatic. Done.");
    await expect(dots.nth(2)).toHaveAccessibleName("Check documents. Loan Associate. Now.");
    await expect(dots.nth(3)).toHaveAccessibleName("DP Processing. Document Processor. Later.");
    await expect(dots.nth(4)).toHaveAccessibleName("LA Acceptance. Loan Associate. Later.");
    for (const [i, name] of STEPS.entries()) await expect(progress.locator("[data-step-name]").nth(i)).toHaveAttribute("data-step-name", name);
    await expect(dots.nth(9)).toHaveAccessibleName("Closure. Admin. Later.");
    // Every label fully visible (at most two lines, not cut).
    const cut = await progress.locator("ol > li > span[aria-hidden]").evaluateAll((els) => els.filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    expect(cut).toEqual([]);
    const h = (await progress.boundingBox())!.height;
    expect(h).toBeLessThanOrEqual(80);
  }
  const next = page.getByRole("region", { name: /Check the papers for Notary/ }).or(page.locator("section[aria-labelledby=next]")).first();
  await expect(next).toContainText("Step 3 of 10");
  if (page.viewportSize()!.width >= 1440) expect((await next.boundingBox())!.height).toBeLessThan(150);
  await noSideScroll(page);
});

test("the current step follows the loan file's real stage", async ({ page }) => {
  await openLoan(page);
  for (const [stage, n] of [["Assigned to DP", 4], ["In process", 4], ["Awaiting LA acceptance", 5], ["For Vault Transmittal", 6], ["In transit to Vault", 6], ["In Safekeeping", 9], ["Closed", 10]] as const) {
    await db.loan.update({ where: { pn: "GD1012026901001" }, data: { stage } });
    await page.reload();
    const progress = page.getByRole("region", { name: "Progress" });
    if (compactStepper(page)) await expect(progress).toContainText(`Step ${n} of 10 · ${STEPS[n - 1]}`);
    else await expect(progress.getByRole("img").nth(n - 1)).toHaveAccessibleName(new RegExp(`${STEPS[n - 1]}\\..*Now\\.`));
    await expect(page.locator("section[aria-labelledby=next]")).toContainText(`Step ${n} of 10`);
    await expect(progress.locator("[data-stage-word]")).toHaveCount(0);
    await noSideScroll(page);
  }
  // No old step name anywhere in the stepper.
  const text = await page.getByRole("region", { name: "Progress" }).innerText();
  for (const old of OLD_NAMES) expect(text.split(/\n| · /).map((x) => x.trim())).not.toContain(old);
});

test("a stage with no step: no highlighted step, its word small and grey under the stepper", async ({ page }) => {
  await openLoan(page);
  for (const [stage, word, done] of [["Cancelled in MyLoans", "Cancelled in MyLoans", 2], ["Archived", "Archived", 10], ["Disposed", "Disposed", 10]] as const) {
    const now = new Date();
    await db.loan.update({ where: { pn: "GD1012026901001" }, data: { stage, cancelledAt: stage === "Cancelled in MyLoans" ? now : null, closedAt: stage === "Cancelled in MyLoans" ? null : now, archivedAt: stage === "Cancelled in MyLoans" ? null : now, disposedAt: stage === "Disposed" ? now : null } });
    await page.reload();
    const progress = page.getByRole("region", { name: "Progress" });
    await expect(progress.locator("[data-stage-word]")).toHaveText(word);
    await expect(progress.locator("[aria-current=step]")).toHaveCount(0);
    await expect(progress).not.toHaveAttribute("data-current-step", /.+/);
    if (compactStepper(page)) await expect(progress).toContainText(done === 10 ? "All 10 steps done" : `${done} of 10 steps done`);
    else for (let i = 0; i < 10; i++) await expect(progress.getByRole("img").nth(i)).toHaveAccessibleName((i < done ? /Done\.$/ : /Later\.$/));
    await expect(page.locator("section[aria-labelledby=next]")).not.toContainText("of 10");
    await noSideScroll(page);
  }
});

test("Check documents: paper rows at most 56px; collapsed rows compact; side card and report row", async ({ page }) => {
  await openLoan(page);
  const main = page.getByRole("main");
  if (!phone(page)) await expect(main.getByRole("region", { name: "Something wrong?" }).getByRole("button", { name: "Report a problem" })).toBeVisible();
  await expect(main.getByText("Send by")).toBeVisible();
  await page.getByRole("link", { name: "Start checking" }).click();
  const notary = page.getByRole("region", { name: "Notary", exact: true });
  const rows = notary.locator("label[id^=line-]");
  await expect(rows).toHaveCount(7);
  const heights = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  for (const h of heights) expect(h).toBeLessThanOrEqual(56);
  // Transactions: every one in number order, a side list at 1100 and up, a strip of cards below that.
  const wide = page.viewportSize()!.width >= 1100;
  const list = wide ? main.getByRole("region", { name: "Transactions (4)" }) : main.getByRole("region", { name: "Transactions", exact: true });
  const otherRows = list.getByRole("button");
  await expect(otherRows).toHaveCount(4);
  const otherHeights = await otherRows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  // Side-list rows stay compact; strip cards also carry the TAT chip (two chip lines at most).
  for (const h of otherHeights) { expect(h).toBeGreaterThanOrEqual(64); expect(h).toBeLessThanOrEqual(wide ? 110 : 130); }
  await noSideScroll(page);
});
