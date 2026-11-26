import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { addDavaoFixture, db, resetLoans } from "./db";
import { docShot, signIn, watchConsole } from "./helpers";

/**
 * D-059: one Loans page for every role. No tabs: one search box and a filter row (Status chips, then a Filters button
 * with Branch, With and Late only), each option with its count; one table (cards on a phone); sort by Borrower, Branch,
 * Amount, Due; 25 or 50 a page; everything in the address. Rows: loan files, released loans not yet in the DMS (D-060: only
 * in a search or with the Not yet in DMS filter; View details opens their preview, loans-preview.spec.ts) (formerly Accept,
 * the first wins) and, for a full PN found nowhere here, what myloans says (logged; names are never sent).
 */
const DIR = "docs/screenshots/ui-refresh";
mkdirSync(DIR, { recursive: true });
const width = (page: Page) => page.viewportSize()!.width;
const main = (page: Page) => page.getByRole("main");
/** Cards under 1024px (phones and tablets); the table from 1024px. */
const phone = (page: Page) => width(page) < 1024;
/** The rows shown at this width (table rows, or cards on a phone), in order. */
const rows = (page: Page) => main(page).locator(phone(page) ? "ul[aria-label=Loans] > li[data-loan-row]" : "[data-loan-table] tr[data-loan-row]");
const pns = async (page: Page) => rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-loan-row")));
const PREFIX = "GD99920999591";
const day = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Six loan files in Angono (165) and Antipolo (101) in different states, and two released loans waiting in the pool. */
async function seed() {
  const [angono, antipolo] = await Promise.all([db.branch.findUniqueOrThrow({ where: { code: "165" } }), db.branch.findUniqueOrThrow({ where: { code: "101" } })]);
  const [la, admin] = await Promise.all([db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } }), db.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } })]);
  const L = [
    { pn: "GD1652026909601", name: "Ana Late", branch: angono, released: day(12), stage: "For checklist", by: la, amount: 900_000 },
    { pn: "GD1652026909602", name: "Ben Fresh", branch: angono, released: day(0), stage: "For checklist", by: la, amount: 500_000 },
    { pn: "GD1012026909603", name: "Carla Held", branch: antipolo, released: day(1), stage: "In process", by: admin, amount: 700_000, hold: true },
    { pn: "GD1012026909604", name: "Dino Problem", branch: antipolo, released: day(1), stage: "For checklist", by: la, amount: 300_000, problem: true },
    { pn: "GD1652026909605", name: "Ely Archived", branch: angono, released: day(40), stage: "Archived", by: la, amount: 100_000, archived: true },
    { pn: "GD1652026909606", name: "Fe Other", branch: angono, released: day(1), stage: "Assigned to DP", by: admin, amount: 650_000 },
  ];
  for (const l of L) {
    const loan = await db.loan.create({ data: {
      pn: l.pn, borrowerName: l.name, branchId: l.branch.id, loanType: "New", productName: "Auto Loan", totalReleasedAmount: l.amount, releasedAt: l.released,
      sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: l.by.id, classification: "FINANCING", mortgageResult: "MORTGAGE", ruleFired: "MORTGAGE_THRESHOLD:New:MET",
      stage: l.stage, stageSince: l.released, ...(l.hold ? { sourceHold: "NotReleased", sourceHoldSince: new Date() } : {}), ...(l.archived ? { archivedAt: new Date(), closedAt: new Date() } : {}),
    } });
    if (l.problem) await db.loanException.create({ data: { loanId: loan.id, type: "OTHER", reason: "Test problem", raisedByLabel: "Test" } });
  }
  for (const [n, name] of [[1, "Gina Pool"], [2, "Hugo Pool"]] as const) {
    const pn = `${PREFIX}${n}`;
    await db.workItem.create({ data: { kind: "LOAN_CANDIDATE", subjectId: pn, role: "LA", branchId: angono.id, pn, label: `${pn}: ${name}`, state: "POOL", measure: "WAITING", arrivedAt: day(n) } });
  }
}
async function clean() {
  await db.workItem.deleteMany({ where: { OR: [{ pn: { startsWith: PREFIX } }, { subjectId: "GD1012026901001", kind: "LOAN_CANDIDATE" }] } });
  await db.sourceLoanCandidate.deleteMany({ where: { externalLoanId: { in: [990_001] } } });
  await db.pnSearchLog.deleteMany({});
}

test.beforeEach(async () => {
  await resetLoans();
  await clean();
  await seed();
});
test.afterAll(async () => {
  await clean();
  await resetLoans();
});

test("one Loans page: no tabs or samples; status chips and Filters on one row with counts; late first, then soonest due", async ({ page }) => {
  const ok = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/loans");
  await expect(main(page).getByRole("heading", { level: 1, name: "Loans" })).toBeVisible();
  for (const gone of ["My queue", "All branch loans", "Needs action ", "Archived "]) await expect(main(page).getByRole("link", { name: gone })).toHaveCount(0);
  await expect(main(page).locator("[data-home-samples]")).toHaveCount(0);
  await expect(main(page).getByRole("button", { name: "Search", exact: true })).toBeVisible();
  // The status chips and the Filters button share one row (on a phone the row may wrap).
  const row = main(page).locator("[data-filter-row]");
  await expect(row.locator("[data-status-option]")).toHaveCount(5);
  await expect(row.locator("[data-more-filters]")).toBeVisible();
  const n = async (k: string) => Number(await row.locator(`[data-status-option="${k}"] [data-filter-n]`).textContent());
  expect(await n("needs")).toBe(3); // Ana, Ben, Dino (For checklist)
  expect(await n("new")).toBe(2);
  expect(await n("hold")).toBe(1);
  expect(await n("problems")).toBe(1);
  expect(await n("archived")).toBe(1);
  // Default: open loans and the pool, archived hidden; late first, then the soonest due; nothing due last.
  const order = await pns(page);
  expect(order[0]).toBe("GD1652026909601");
  expect(order).not.toContain("GD1652026909605");
  // D-060: the default list has no pool rows (released loans not yet in the DMS); the filter shows them.
  expect(order.sort()).toEqual(["GD1012026909603", "GD1012026909604", "GD1652026909601", "GD1652026909602", "GD1652026909606"]);
  await expect(main(page).locator("[data-not-in-dms]")).toHaveCount(0);
  await page.goto("/loans?status=new");
  const pool = rows(page).filter({ has: page.locator(`[data-pn]`, { hasText: `${PREFIX}1` }) });
  await expect(pool.locator("[data-not-in-dms]")).toHaveText("myloans · Not yet in DMS");
  // D-060: the table says "Branch pool" (the full wording in its tooltip); a card says "In the branch pool since ...".
  await expect(pool).toContainText(phone(page) ? "In the branch pool since" : "Branch pool");
  await expect(pool.getByRole("link", { name: /^View details of/ })).toHaveAttribute("href", `/loans/preview/${PREFIX}1`);
  await expect(main(page).getByRole("button", { name: /Accept/ })).toHaveCount(0);
  await page.goto("/loans");
  // A loan file row: Status / next step in one column, the badges, View details.
  const ana = rows(page).filter({ hasText: "Ana Late" });
  await expect(ana.locator("[data-next-text]")).toContainText(/\S/);
  await expect(ana.locator('[data-badge="loan-type"]')).toHaveText("New");
  await expect(ana.locator('[data-badge="classification"]')).toHaveText("Financing");
  // The two badges stay on one line.
  const [t1, t2] = [(await ana.locator('[data-badge="loan-type"]').boundingBox())!, (await ana.locator('[data-badge="classification"]').boundingBox())!];
  expect(Math.abs(t1.y - t2.y)).toBeLessThanOrEqual(1);
  // The PN and its Copy button on one line, centred on each other (the user's review).
  const [pnBox, copyBox] = [(await ana.locator("[data-pn]").boundingBox())!, (await ana.getByRole("button", { name: "Copy PN GD1652026909601" }).boundingBox())!];
  expect(Math.abs((pnBox.y + pnBox.height / 2) - (copyBox.y + copyBox.height / 2))).toBeLessThanOrEqual(2);
  expect(copyBox.x).toBeGreaterThan(pnBox.x + pnBox.width - 1);
  expect(await ana.locator("[data-pn]").evaluate((e) => e.getClientRects().length)).toBe(1); // not wrapped
  if (!phone(page)) await expect(ana.getByRole("link", { name: "View details of Ana Late, GD1652026909601" })).toHaveText("View details");
  await expect(ana.locator("[data-due]")).toContainText(/Late by/);
  if (!phone(page)) {
    // Only these columns, in this order.
    const heads = await main(page).locator("[data-loan-table] thead th").evaluateAll((ths) => ths.map((t) => (t.textContent ?? "").replace(/[↑↓]|, sort.*$|, sorted.*$/g, "").trim()));
    expect(heads).toEqual(["Borrower", "Branch", "Loan", "Released on", "Released amount", "Status / next step", "Assigned to", "Due", "Action"]);
    await expect(ana.locator('[data-col="released"]')).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/); // the release date, its own column
  }
  ok();
});

test("each filter, its count, and the address keeps it (reload and Back)", async ({ page }) => {
  await signIn(page, "la");
  await page.goto("/loans");
  const chip = (k: string) => main(page).locator(`[data-status-option="${k}"]`);
  await chip("needs").click();
  await expect(page).toHaveURL(/status=needs/);
  await expect.poll(() => pns(page)).toEqual(["GD1652026909601", "GD1012026909604", "GD1652026909602"]);
  await chip("hold").click(); // multi-select: needs OR hold
  await expect(page).toHaveURL(/status=needs%2Chold|status=needs,hold/);
  await expect.poll(async () => (await pns(page)).length).toBe(4);
  await chip("needs").click();
  await chip("hold").click();
  await chip("new").click();
  await expect.poll(async () => (await pns(page)).sort()).toEqual([`${PREFIX}1`, `${PREFIX}2`]);
  await chip("new").click();
  await chip("problems").click();
  await expect.poll(() => pns(page)).toEqual(["GD1012026909604"]);
  await chip("problems").click();
  await chip("archived").click();
  await expect.poll(() => pns(page)).toEqual(["GD1652026909605"]);
  await chip("archived").click();
  await expect(page).toHaveURL(/\/loans$/);

  // Filters: Branch, With (Me / Branch pool) and Late only, each with its count.
  const open = async () => { if (!(await page.locator("[data-more-filters-panel]").isVisible())) await main(page).locator("[data-more-filters]").click(); return page.locator("[data-more-filters-panel]"); };
  let panel = await open();
  const antipolo = await db.branch.findUniqueOrThrow({ where: { code: "101" } });
  await panel.getByLabel("Branch").selectOption(antipolo.id);
  await expect(page).toHaveURL(new RegExp(`branch=${antipolo.id}`));
  await expect.poll(async () => (await pns(page)).sort()).toEqual(["GD1012026909603", "GD1012026909604"]);
  panel = await open();
  await panel.getByLabel("Branch").selectOption("");
  panel = await open();
  await expect(panel.locator('[data-with-option="me"] [data-filter-n]')).toHaveText("3"); // Ana, Ben and Dino (opened by the LA; Ely is archived)
  await panel.locator('[data-with-option="pool"]').click();
  await expect(page).toHaveURL(/with=pool/);
  await expect(main(page).locator("[data-empty-line]")).toBeVisible(); // the pool rows only with Not yet in DMS (D-060)
  await chip("new").click();
  await expect.poll(async () => (await pns(page)).sort()).toEqual([`${PREFIX}1`, `${PREFIX}2`]);
  await chip("new").click();
  panel = await open();
  await panel.locator('[data-with-option="me"]').click();
  await expect(page).toHaveURL(/with=me/);
  await expect.poll(async () => (await pns(page)).sort()).toEqual(["GD1012026909604", "GD1652026909601", "GD1652026909602"]);
  await expect(main(page).locator("[data-filter-count]")).toHaveText("1");
  panel = await open();
  const lateN = Number(await panel.locator('[data-filter="late"] [data-filter-n]').textContent());
  expect(lateN).toBeGreaterThanOrEqual(1); // Ana (and Dino, 1 day old, on some days of the week)
  await panel.getByLabel("Late only").check();
  await expect(page).toHaveURL(/late=1/);
  await expect.poll(async () => (await pns(page)).length).toBe(lateN);
  expect((await pns(page))[0]).toBe("GD1652026909601");
  await expect(main(page).locator("[data-filter-count]")).toHaveText("2");
  // The address keeps it: reload, then Back to the step before.
  await page.reload();
  await expect.poll(async () => (await pns(page)).length).toBe(lateN);
  await page.goBack();
  await expect(page).not.toHaveURL(/late=1/);
  await expect.poll(async () => (await pns(page)).length).toBe(3);
  await main(page).locator("[data-clear-filters]").click();
  await expect(page).toHaveURL(/\/loans$/);
});

test("sort by Borrower, Branch, Amount and Due; 25 a page with Previous / Next, or 50", async ({ page }) => {
  await signIn(page, "admin");
  // 30 more loan files so the list has two pages.
  const [angono, admin] = await Promise.all([db.branch.findUniqueOrThrow({ where: { code: "165" } }), db.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } })]);
  await db.loan.createMany({ data: Array.from({ length: 30 }, (_, i) => ({
    pn: `GD16520269097${String(i).padStart(2, "0")}`, borrowerName: `Zed Page ${String(i).padStart(2, "0")}`, branchId: angono.id, loanType: "New", productName: "Auto Loan",
    totalReleasedAmount: 10_000 + i, releasedAt: day(0), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: admin.id, classification: "FINANCING" as const,
    mortgageResult: "MORTGAGE" as const, ruleFired: "x", stage: "Assigned to DP", stageSince: new Date(),
  })) });
  await page.goto("/loans");
  await expect(main(page).locator("[data-loans-total]")).toHaveText("35 loans"); // 5 open loan files and 30 more; the 2 pool items only with Not yet in DMS (D-060)
  await expect(rows(page)).toHaveCount(25);
  await expect(main(page).locator("[data-pager-range]")).toHaveText("Showing 1–25 of 35 loans");
  await expect(main(page).locator("[data-page-number=\"1\"]")).toHaveAttribute("aria-current", "page");
  await expect(main(page).locator("[data-page-number=\"2\"]")).toBeVisible();
  await main(page).locator("[data-pager-next]").click();
  await expect(page).toHaveURL(/page=2/);
  await expect(rows(page)).toHaveCount(10);
  await main(page).getByRole("link", { name: "50" }).click();
  await expect(page).toHaveURL(/per=50/);
  await expect(page).not.toHaveURL(/page=/);
  await expect(rows(page)).toHaveCount(35);
  // The released amount: the largest first.
  await page.goto("/loans?sort=amount");
  expect((await pns(page))[0]).toBe("GD1652026909601");
  if (!phone(page)) {
    await expect(main(page).locator('[data-sort="amount"]')).toHaveAttribute("aria-sort", "descending");
    await main(page).locator('[data-sort="borrower"] a').click();
    await expect(page).toHaveURL(/sort=borrower/);
    await expect(main(page).locator('[data-sort="borrower"]')).toHaveAttribute("aria-sort", "ascending");
    expect((await pns(page))[0]).toBe("GD1652026909601"); // Ana
    await main(page).locator('[data-sort="borrower"] a').click();
    await expect(page).toHaveURL(/dir=desc/);
    await expect.poll(async () => (await pns(page))[0]).toBe("GD1652026909729"); // Zed Page 29
    if (width(page) >= 1024) { // the Branch column (under 1024px the branch sits under the PN)
      await main(page).locator('[data-sort="branch"] a').click();
      await expect.poll(async () => (await pns(page))[0]).toMatch(/^GD165/); // Angono before Antipolo
      // Released on: the newest first, then the oldest first (Ana, 12 days ago).
      await main(page).locator('[data-sort="released"] a').click();
      await expect(main(page).locator('[data-sort="released"]')).toHaveAttribute("aria-sort", "descending");
      await main(page).locator('[data-sort="released"] a').click();
      await expect(main(page).locator('[data-sort="released"]')).toHaveAttribute("aria-sort", "ascending");
      await expect.poll(async () => (await pns(page))[0]).toBe("GD1652026909601");
    }
    await main(page).locator('[data-sort="due"] a').click();
    await expect(page).toHaveURL(/\/loans(\?per=50)?$/);
  }
});

test("a full PN not in the DMS or a pool: myloans once, logged (found, cancelled, not released, not found)", async ({ page }) => {
  await signIn(page, "la");
  const cases = [
    { pn: "GD1012026901001", sel: "[data-find-preview]", outcome: "PREVIEW" },
    { pn: "GD1012026901013", sel: '[data-feed-state="Cancelled"]', outcome: "NOT_SELECTABLE" },
    { pn: "GD1652026901008", sel: '[data-feed-state="NotReleased"]', outcome: "NOT_SELECTABLE" },
    { pn: "GD1012026999999", sel: '[data-find-problem="not_found"]', outcome: "NOT_FOUND" },
  ];
  for (const c of cases) {
    await page.goto(`/loans?q=${c.pn}`);
    await expect(main(page).locator(c.sel)).toBeVisible();
    await expect(main(page).locator("[data-myloans-result]")).toHaveCount(1);
    await expect.poll(() => db.pnSearchLog.count({ where: { pn: c.pn, outcome: c.outcome } })).toBe(1);
  }
  await expect(main(page).locator("[data-myloans-heading]")).toHaveText("Not in the DMS: what myloans says");
  // A loan file here: no myloans call; the search is logged as found in the DMS.
  await page.goto("/loans?q=GD1652026909601");
  await expect(rows(page)).toHaveCount(1);
  await expect(main(page).locator("[data-myloans-result]")).toHaveCount(0);
  await expect.poll(() => db.pnSearchLog.count({ where: { pn: "GD1652026909601", outcome: "FOUND_IN_DMS" } })).toBe(1);
  // The old Find a loan address lands here.
  await page.goto("/search?q=GD1652026909602");
  await expect(page).toHaveURL(/\/loans\?q=GD1652026909602$/);
  await expect(rows(page)).toHaveCount(1);
});

test("names and parts of a PN are never sent to myloans; the search runs as you type and on Enter", async ({ page }) => {
  await signIn(page, "la");
  await page.goto("/loans");
  const box = main(page).locator("#find-loan");
  await expect(box).toHaveAttribute("placeholder", "Search PN, name or CIN");
  await box.fill("carla");
  await expect(page).toHaveURL(/q=carla/); // after a short pause
  await expect.poll(() => pns(page)).toEqual(["GD1012026909603"]);
  await box.fill("10120269096");
  await box.press("Enter");
  await expect(page).toHaveURL(/q=10120269096/);
  await expect.poll(async () => (await pns(page)).sort()).toEqual(["GD1012026909603", "GD1012026909604"]);
  await box.fill("Nobody Here");
  await box.press("Enter");
  await expect(main(page).locator("[data-empty-line]")).toContainText('No loans match "Nobody Here"');
  // Nothing went to myloans: no log row and no call counted.
  expect(await db.pnSearchLog.count()).toBe(0);
  expect(await db.myLoansCallHour.count()).toBe(0);
  await expect(main(page).locator("[data-myloans-result]")).toHaveCount(0);
});

test("branch scope: another branch's loan file is not listed for the LA; its PN says outside your branches", async ({ page }) => {
  await addDavaoFixture();
  const pn = "GD3902026909007";
  await signIn(page, "la");
  await page.goto("/loans?status=needs,hold,problems,archived");
  expect(await pns(page)).not.toContain(pn);
  await main(page).locator("[data-more-filters]").click();
  const opts = await page.locator("[data-more-filters-panel] select option").allTextContents();
  expect(opts.some((o) => o.startsWith("Alaminos"))).toBe(false);
  await page.goto(`/loans?q=${pn}`);
  await expect(rows(page)).toHaveCount(0);
  await expect(main(page).locator('[data-find-problem="branch"]')).toBeVisible();
  await signIn(page, "admin");
  await page.goto(`/loans?q=${pn}`);
  await expect(rows(page)).toHaveCount(1);
});

test("phone and tablet: each row is a compact card with the same data, on one left edge", async ({ page }) => {
  test.skip(!phone(page), "Cards are the phone's and tablet's list.");
  await signIn(page, "la");
  await page.goto("/loans");
  await expect(main(page).locator("[data-loan-table]")).toBeHidden();
  const card = rows(page).filter({ hasText: "Ana Late" });
  await expect(card.locator("[data-loan-name]")).toHaveText("Ana Late");
  await expect(card.locator("[data-pn]")).toHaveText("GD1652026909601");
  await expect(card.getByRole("button", { name: "Copy PN GD1652026909601" })).toBeVisible();
  await expect(card.locator("[data-branch-amount]")).toContainText("Angono");
  await expect(card.locator("[data-next-text]")).toContainText(/\S/);
  await expect(card.locator("[data-card-meta]")).toContainText("Assigned to Test Loan Associate");
  // Every line starts on the same left edge.
  const lefts = await card.evaluate((c) => [...c.children].map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(1);
  await expect(card.locator("[data-due]")).toContainText("Late by");
  await expect(card.getByRole("link", { name: /^View details of/ })).toBeVisible();
  await page.goto("/loans?status=new");
  const pool = rows(page).filter({ hasText: "Gina Pool" });
  await expect(pool.getByRole("link", { name: /^View details of/ })).toBeVisible();
  await expect(pool.locator("[data-not-in-dms]")).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
});

test("screenshots: the Loans page as the LA and as Admin", async ({ page }) => {
  for (const who of ["la", "admin"] as const) {
    await signIn(page, who);
    await page.goto("/loans");
    await expect(rows(page).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await docShot(page, { path: `${DIR}/loans-${who}-${width(page)}.png`, fullPage: true });
    if (width(page) === 1440) {
      // An office laptop (1366px): the table fits without its own scroll; the release date is the Loan cell's second line.
      const size = page.viewportSize()!;
      await page.setViewportSize({ width: 1366, height: 768 });
      await expect(main(page).locator('[data-col="released"]').first()).toBeHidden();
      await expect(rows(page).first().locator("[data-released-inline]")).toHaveText(/^Released [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
      expect(await main(page).locator("[data-loan-table]").evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
      await docShot(page, { path: `${DIR}/loans-${who}-1366.png`, fullPage: true });
      await page.setViewportSize(size);
    }
  }
  await signIn(page, "la");
  await page.goto("/loans");
  await main(page).locator("[data-more-filters]").click();
  await expect(page.locator("[data-more-filters-panel]")).toBeVisible();
  await docShot(page, { path: `${DIR}/loans-filters-open-${width(page)}.png` });
});
