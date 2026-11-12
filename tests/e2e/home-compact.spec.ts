import { expect, test, type Page } from "@playwright/test";
import { cleanTestRoles, db, resetLoans } from "./db";
import { watchConsole } from "./helpers";

/**
 * Home, compact and minimalist, for every role: header (no count in the greeting), one summary strip,
 * "Do these next" first, alert cards only when non-zero, one "All clear" line otherwise, the side column
 * only when it has something. Screenshots at 1440, 820 and 390: docs/screenshots/home-compact/.
 */
const DIR = "docs/screenshots/home-compact";
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.getByRole("main");
const strip = (page: Page) => main(page).getByRole("region", { name: "Counts" });
const seg = (page: Page, key: string) => strip(page).locator(`[data-segment="${key}"]`);
const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin", dp: "Continue as Test Document Processor", fin: "Continue as Test Finance", monitor: "Continue as Test Operations Monitor" } as const;

async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(who === "monitor" ? /\/monitoring/ : /\/dashboard/);
}
async function signInOther(page: Page, label: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Other test user").selectOption({ label });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard|\/monitoring/);
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
/** The greeting has no number; "Do these next" (or the caught-up line) comes before every alert card. */
async function layoutRules(page: Page) {
  await expect(main(page).getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  expect(await main(page).locator("[data-home-greeting]").textContent()).not.toMatch(/\d+ (loan|job)/);
  expect(await main(page).locator("[data-home-greeting]").textContent()).toMatch(/· Good (morning|afternoon|evening)/);
  const order = await main(page).evaluate((m) => {
    const first = m.querySelector("[data-do-next], [data-caught-up]");
    const alerts = Array.from(m.querySelectorAll("[data-home-main] section[aria-labelledby]:not([data-do-next]), [data-home] > section[aria-labelledby]:not([data-do-next])"));
    return alerts.every((a) => first && first.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  // One "All clear" line or the alert cards, never both, never an empty card.
  const alerts = await main(page).locator("[data-source-changes-card], [data-borrower-corrections-card], [data-branch-review-card], [data-tat-card], [data-packages-to-receive], [data-sent-back-home], [data-liquidation-overdue]").count();
  await expect(main(page).locator("[data-all-clear]")).toHaveCount(alerts ? 0 : 1);
  await noSideways(page);
}

// ---------------------------------------------------------------------------
// Fixtures (test database only)
// ---------------------------------------------------------------------------

let n = 0;
async function loan(stage: string, name: string) {
  const angono = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  n += 1;
  return db.loan.create({
    data: {
      pn: `GD1652026908${String(800 + n).padStart(3, "0")}`, borrowerName: name, branchId: angono.id, loanType: "New", productName: "Auto Refinancing",
      totalReleasedAmount: 400000 + n * 1000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: la.id,
      classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "MORTGAGE_THRESHOLD:New:MET", stage,
    },
  });
}
const NAMES = ["Ana Villanueva", "Ramon Garcia", "Liza Torres", "Mario Reyes", "Nora Santos", "Pedro Cruz", "Gina Lopez", "Tess Ramos"];
async function change(loanId: string, category: "BORROWER" | "MATERIAL") {
  const changes = category === "BORROWER" ? [{ field: "borrowerAddress", label: "Address", was: "Angono", now: "12 Rizal Ave, Angono", kind: "BORROWER" }] : [{ field: "amount", label: "Amount", was: 40_000_000, now: 52_000_000, kind: "MATERIAL" }];
  await db.sourceChange.create({ data: { loanId, category, changes, proposed: {}, hash: `e2e-${loanId}-${category}` } });
}
async function supervisor() {
  const angono = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  const role = await db.role.findFirstOrThrow({ where: { name: "Branch Supervisor" } });
  const u = await db.user.create({ data: { email: "zz.home.sup@gdfi.ph", name: "Zz Home Supervisor", roleId: role.id, isTestUser: true, homeBranchId: angono.id } });
  await db.userAccessGrant.create({ data: { userId: u.id, kind: "BRANCH", branchId: angono.id } });
  await db.userBranch.create({ data: { userId: u.id, branchId: angono.id } });
  return `Zz Home Supervisor (${role.name})`;
}

test.beforeEach(async () => {
  await resetLoans();
  await cleanTestRoles();
  n = 0;
});
test.afterAll(async () => {
  await db.cashAdvance.deleteMany({ where: { number: { startsWith: "CA-2099-" } } });
  await resetLoans();
  await cleanTestRoles();
});

// ---------------------------------------------------------------------------
// Loan Associate
// ---------------------------------------------------------------------------

test("LA with nothing: zeros muted, You're all caught up, one All clear line; samples collapsed (test mode)", async ({ page }) => {
  const clean = watchConsole(page);
  await signInAs(page, "la");
  await layoutRules(page);
  await expect(strip(page).getByRole("listitem")).toHaveCount(3);
  for (const k of ["need", "waiting", "problems"]) await expect(seg(page, k)).toHaveAttribute("data-count", "0");
  await expect(strip(page).locator("[data-dot]")).toHaveCount(0); // zeros: no dot
  await expect(main(page).locator("[data-caught-up]")).toHaveText("You're all caught up.");
  await expect(main(page).locator("[data-do-next]")).toHaveCount(0);
  await expect(main(page).locator("[data-collapsed]")).toHaveCount(0);
  // Test mode: the samples, closed; one line per sample once opened.
  const samples = main(page).locator("[data-home-samples]");
  await expect(samples).not.toHaveAttribute("open", "");
  await expect(samples.getByText("Sample loans")).toBeVisible();
  await expect(samples.getByRole("button", { name: /^GD/ }).first()).toBeHidden();
  await shot(page, "la-nothing");
  await samples.locator("summary").click();
  await expect(samples.getByRole("button", { name: /^GD/ }).first()).toBeVisible();
  await expect(samples.getByText("Pick one, then press Find loan.")).toBeVisible();
  clean();
});

test("LA with one task: Do these next first, one compact row (no Next step label), the counts as before", async ({ page }) => {
  const clean = watchConsole(page);
  await loan("For checklist", "Ana Villanueva");
  await signInAs(page, "la");
  await layoutRules(page);
  await expect(seg(page, "need")).toHaveAttribute("data-count", "1");
  await expect(seg(page, "need").getByRole("link", { name: "1 Need you now, open" })).toHaveAttribute("href", "/loans?tab=queue");
  await expect(seg(page, "need").locator('[data-dot="act"]')).toHaveCount(1);
  await expect(seg(page, "waiting").getByRole("link")).toHaveAttribute("href", "/loans?tab=all&group=waiting");
  await expect(seg(page, "problems").getByRole("link")).toHaveAttribute("href", "/loans?tab=exceptions");
  const list = main(page).locator("[data-do-next]");
  await expect(list.getByRole("heading", { name: "Do these next" })).toBeVisible();
  const row = list.locator("[data-home-row]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("GD1652026908801 · Angono · ₱401,000");
  await expect(row).toContainText("Continue");
  await expect(list.getByText("Next step", { exact: true })).toHaveCount(0);
  await expect(main(page).locator("[data-see-all]")).toHaveCount(0);
  if (width(page) >= 640) expect((await row.boundingBox())!.height).toBeLessThanOrEqual(60);
  await expect(main(page).locator("[data-all-clear]")).toHaveText("Nothing to review and no problems.");
  await shot(page, "la-one-task");
  clean();
});

test("LA with eight tasks and two waiting: six rows and See all (8); Waiting on others as one collapsed row", async ({ page }) => {
  const clean = watchConsole(page);
  for (const nm of NAMES) await loan("For checklist", nm);
  await loan("In process", "Waiting One");
  await loan("Assigned to DP", "Waiting Two");
  await signInAs(page, "la");
  await layoutRules(page);
  await expect(seg(page, "need")).toHaveAttribute("data-count", "8");
  await expect(seg(page, "waiting")).toHaveAttribute("data-count", "2");
  const list = main(page).locator("[data-do-next]");
  await expect(list.locator("[data-home-row]")).toHaveCount(6);
  await expect(list.locator("[data-see-all]")).toHaveText("See all (8)");
  await expect(list.locator("[data-see-all]")).toHaveAttribute("href", "/loans?tab=queue");
  // Only the first row has the navy Continue.
  await expect(list.locator("[data-home-row]").first()).toContainText("Continue");
  await expect(list.locator("[data-home-row]").nth(1)).toContainText("Open");
  const waiting = main(page).locator('[data-collapsed="waiting"]');
  await expect(waiting.locator("summary")).toContainText("Waiting on others · 2");
  await expect(waiting).not.toHaveAttribute("open", "");
  await expect(main(page).locator('[data-collapsed="problems"]')).toHaveCount(0);
  if (width(page) === 1440) {
    // The strip and the first three rows without scrolling.
    expect(await list.locator("[data-home-row]").nth(2).evaluate((e) => e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(900);
  }
  await shot(page, "la-many-tasks");
  await waiting.locator("summary").click();
  await expect(waiting.locator("[data-home-row]")).toHaveCount(2);
  clean();
});

// ---------------------------------------------------------------------------
// Document Processor, Finance, approver, Admin, Supervisor, Monitor
// ---------------------------------------------------------------------------

test("Document Processor: five counts in the strip (two rows at most), Do these next or the caught-up line", async ({ page }) => {
  const clean = watchConsole(page);
  await signInAs(page, "dp");
  await layoutRules(page);
  await expect(strip(page).getByRole("listitem")).toHaveText([/To review/, /In process/, /Problems?/, /Need funds/, /On hold/]);
  const ys = new Set(await strip(page).getByRole("listitem").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top))));
  expect(ys.size).toBeLessThanOrEqual(width(page) < 640 ? 3 : 2);
  await expect(main(page).getByRole("link", { name: "All jobs" })).toHaveAttribute("href", "/jobs");
  await shot(page, "dp");
  clean();
});

test("Finance: the four funds counts, Open Funds, outstanding cash in one line", async ({ page }) => {
  const clean = watchConsole(page);
  await signInAs(page, "fin");
  await layoutRules(page);
  await expect(strip(page).getByRole("listitem")).toHaveText([/To approve/, /To release/, /Outstanding/, /Overdue/]);
  await expect(main(page).getByRole("link", { name: "Open Funds" })).toHaveAttribute("href", "/funds");
  await expect(main(page).locator("[data-outstanding-cash]")).toContainText("Outstanding cash:");
  await shot(page, "finance");
  clean();
});

test("an approver with funds requests waiting: To approve shows the request (permission ticks, not a role name)", async ({ page }) => {
  const clean = watchConsole(page);
  const role = await db.role.create({ data: { key: "C_Z_HOME_APPROVER", name: "Z Home approver", builtIn: false, permissions: ["funds:ca_view", "funds:ca_approve", "funds:kinds_view"] } });
  await db.user.create({ data: { email: "zz.home.approver@gdfi.ph", name: "Zz Home Approver", roleId: role.id, isTestUser: true, allBranches: true } });
  const dp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  const angono = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  await db.cashAdvance.create({ data: { requestedById: dp.id, branchId: angono.id, number: "CA-2099-0001", requestedCents: 250_000, lines: { create: [{ kind: "OTHER", otherDescription: "Courier", requestedCents: 250_000 }] } } });
  await signInOther(page, "Zz Home Approver (Z Home approver)");
  await layoutRules(page);
  await expect(seg(page, "approve")).toHaveAttribute("data-count", "1");
  await expect(seg(page, "approve").getByRole("link")).toHaveAttribute("href", "/funds?tab=approve");
  await expect(seg(page, "approve").locator('[data-dot="act"]')).toHaveCount(1);
  await expect(main(page).locator("[data-caught-up]")).toHaveCount(0);
  await shot(page, "approver-funds-waiting");
  clean();
});

test("Admin with a MyLoans review waiting: the count in the strip and one slim card; empty blocks are not rendered", async ({ page }) => {
  const clean = watchConsole(page);
  const l = await loan("For checklist", "Ana Villanueva");
  await change(l.id, "MATERIAL");
  await signInAs(page, "admin");
  await layoutRules(page);
  await expect(seg(page, "source")).toHaveAttribute("data-count", "1");
  const card = main(page).locator("[data-source-changes-card]");
  await expect(card.locator("[data-source-count]")).toHaveText("1");
  await expect(card).toContainText(l.pn);
  await expect(main(page).locator("[data-all-clear]")).toHaveCount(0);
  // The TAT card only with something in it; its link says what it does (no export there).
  const tat = main(page).locator("[data-tat-card]");
  if (await tat.count()) await expect(tat.getByRole("link", { name: "Open the TAT report" })).toHaveAttribute("href", "/reports/tat");
  await expect(main(page).getByText("Filter and export")).toHaveCount(0);
  await shot(page, "admin-review-waiting");
  clean();
});

test("Branch Supervisor with decisions waiting: Corrections to review in the strip and its card", async ({ page }) => {
  const clean = watchConsole(page);
  const label = await supervisor();
  const l = await loan("For checklist", "Ana Villanueva");
  await change(l.id, "BORROWER");
  await signInOther(page, label);
  await layoutRules(page);
  await expect(seg(page, "corrections")).toHaveAttribute("data-count", "1");
  await expect(seg(page, "corrections").getByRole("link")).toHaveAttribute("href", "#corr-h");
  const card = main(page).locator("[data-borrower-corrections-card]");
  await expect(card.locator("[data-borrower-count]")).toHaveText("1");
  await expect(card).toContainText("Address");
  await shot(page, "supervisor-decisions");
  clean();
});

test("Branch Supervisor with nothing: zeros, caught up, one All clear line", async ({ page }) => {
  const clean = watchConsole(page);
  const label = await supervisor();
  await signInOther(page, label);
  await layoutRules(page);
  await expect(seg(page, "corrections")).toHaveAttribute("data-count", "0");
  await expect(seg(page, "corrections").getByRole("link")).toHaveCount(0); // nothing to open
  await expect(main(page).locator("[data-caught-up]")).toBeVisible();
  await expect(main(page).locator("[data-all-clear]")).toBeVisible();
  await shot(page, "supervisor-nothing");
  clean();
});

test("Operations Monitor: Home is the Monitoring page, as before", async ({ page }) => {
  const clean = watchConsole(page);
  await signInAs(page, "monitor");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/monitoring/);
  await noSideways(page);
  await shot(page, "monitor");
  clean();
});
