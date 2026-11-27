import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { docShot, signIn } from "./helpers";

/**
 * D-063: the compact, quick Inbox. One row per loan (its transactions as chips), one status chip ("1 day left",
 * "Late by 2 days", "Due today", "Paused"); the whole row opens a details panel (side panel, bottom sheet on a phone)
 * without leaving the Inbox; both lists come with the page so a tab switches with no page load; Branch pool rows open
 * the loan preview card; the amount only with "See loan amounts"; Set away in the header; quick filters in My items.
 * Screenshots: docs/screenshots/ui-refresh/inbox-{my-items,branch-pool,panel}-<width>.png (inbox-mine / inbox-pool are ui-refresh.spec's).
 */
const DIR = "docs/screenshots/ui-refresh";
mkdirSync(DIR, { recursive: true });
const PN = "GD1012026901001"; // Maria Santos, Antipolo (sample myloans): Refinancing, four transactions, 450,000
const POOL = ["GD1012026901002", "GD1012026901013"]; // Antipolo: Financing (two questions); cancelled in myloans
const AMOUNT = /450,000|450000/;
const KEY = "loans:view_amounts";
const width = (page: Page) => page.viewportSize()!.width;
const shot = (page: Page, name: string) => docShot(page, { path: `${DIR}/${name}-${width(page)}.png`, fullPage: name !== "inbox-panel" });
const rows = (page: Page, tab: string) => page.locator(`[data-inbox-pane=${tab}] [data-inbox-row]`);
const panel = (page: Page) => page.getByRole("dialog");

async function pool(pn: string, name: string, n: number) {
  const branch = await db.branch.findUniqueOrThrow({ where: { code: "101" } });
  await db.sourceLoanCandidate.create({ data: { externalLoanId: 990_400 + n, pn, cin: `CIN-${n}`, borrowerName: name, branchCode: "101", branchName: branch.name, productName: "Auto Financing", amount: "300000", releaseDate: new Date(Date.now() - 6 * 86_400_000) } });
  await db.workItem.create({ data: { kind: "LOAN_CANDIDATE", subjectId: pn, role: "LA", branchId: branch.id, pn, label: `${pn}: ${name}`, state: "POOL", measure: "WAITING", arrivedAt: new Date(Date.now() - n * 86_400_000) } });
}
async function clean() {
  await db.workItem.deleteMany({ where: { kind: "LOAN_CANDIDATE", subjectId: { in: POOL } } });
  await db.sourceLoanCandidate.deleteMany({ where: { pn: { in: POOL } } });
  await db.userPermissionOverride.deleteMany({ where: { key: KEY } });
  await db.user.updateMany({ where: { email: "test.la@gdfi.ph" }, data: { awayFrom: null, awayTo: null, awayNote: "" } });
}
test.beforeEach(async () => {
  await resetLoans();
  await clean();
  await pool(POOL[0], "Pool Financing", 1);
  await pool(POOL[1], "Andres Lim", 2);
});
test.afterAll(async () => {
  await clean();
  await resetLoans();
});

async function openLoan(page: Page) {
  await signIn(page, "la");
  await page.goto(`/search?q=${PN}`);
  await page.getByRole("main").getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
}
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("one row per loan: the status chip, borrower, PN, transactions as chips, branch, due; no Open button or link", async ({ page }) => {
  await openLoan(page);
  await page.goto("/inbox");
  // Header: same size as other pages, one short line and the (i).
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toHaveCSS("font-size", "22px");
  await expect(page.getByRole("main")).toContainText("Your work, least time left first.");
  await page.locator("[data-info-tip=inbox]").hover();
  await expect(page.locator("[data-info-tip-text=inbox]")).toBeVisible();
  // Two lines: My items on top, Branch pool below.
  const tip = page.locator("[data-info-tip-text=inbox]");
  await expect(tip.locator("[data-tip-line=mine]")).toHaveText("My items = work you've taken.");
  await expect(tip.locator("[data-tip-line=pool]")).toHaveText("Branch pool = new work nobody has taken yet.");
  expect((await tip.locator("[data-tip-line=pool]").boundingBox())!.y).toBeGreaterThan((await tip.locator("[data-tip-line=mine]").boundingBox())!.y);
  const tb = (await tip.boundingBox())!;
  expect(tb.x).toBeGreaterThanOrEqual(0); // never off the screen (a phone too)
  expect(tb.x + tb.width).toBeLessThanOrEqual(width(page));
  await page.mouse.move(0, 0);
  await expect(tip).toBeHidden();
  // The four transactions of the loan are ONE row.
  const row = rows(page, "mine");
  await expect(row).toHaveCount(1);
  await expect(page.locator("[data-inbox-tab=mine] [data-tab-count]")).toHaveText("1");
  await expect(row).toHaveAttribute("data-inbox-row", PN);
  await expect(row.locator("[data-row-name]")).toHaveText("Maria Santos");
  await expect(row.locator("[data-row-pn]")).toHaveText(PN);
  await expect(row.locator("[data-row-txn]")).toHaveText(["Notary", "EDST", "Entry of PPSR", "Mortgage"]);
  await expect(row.locator("[data-row-step]")).toHaveText("· Check and send");
  await expect(row.locator("[data-row-branch]")).toContainText("Antipolo");
  // The release date and the released amount (the LA has "See loan amounts").
  await expect(row.locator("[data-row-released-on]")).toHaveText(/Released [A-Z][a-z]{2} \d{1,2}, \d{4}$/); // with the year
  await expect(row.locator("[data-row-amount]")).toHaveText(/₱450,000/);
  await expect(row.locator("[data-row-due]")).toHaveText(/Due [A-Z][a-z]{2} \d{1,2}, \d{4}$/); // with the year
  await expect(row.locator("[data-row-status]")).toHaveText(/^(Late by \d+ days?|Due today|\d+ days? left|Paused)$/);
  // Gone from the row: the measure text, the Open button, the title link, the waiting time.
  await expect(row).not.toContainText("Turnaround time");
  await expect(row).not.toContainText("Waited");
  await expect(row.locator("a")).toHaveCount(0);
  await expect(page.locator("[data-inbox-pane=mine]").getByRole("link", { name: "Open", exact: true })).toHaveCount(0);
  // Nothing cut: the name and the PN are whole.
  const cut = await row.locator("[data-row-name], [data-row-pn]").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(cut).toBe(0);
  if (width(page) >= 1024) {
    // Desktop: about 48-56 px, one line (status, name, PN, chips, branch, due on the same line).
    const h = (await row.boundingBox())!.height;
    expect(h).toBeLessThanOrEqual(56);
    const ys = await row.locator("[data-row-status], [data-row-who], [data-row-branch], [data-row-due]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(4);
  }
  const box = async (sel: string) => (await row.locator(sel).boundingBox())!;
  const [who, st, txns, branch, due] = [await box("[data-row-who]"), await box("[data-row-status]"), await box("[data-row-txns]"), await box("[data-row-branch]"), await box("[data-row-due]")];
  if (width(page) >= 1024) {
    // Desktop: name and PN, branch, transactions, amount, released date, due date and status, each in its own
    // column, left to right, on one line.
    const xs = [who, branch, txns, await box("[data-row-amount]"), await box("[data-row-released-on]"), due, st].map((b) => b.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    const rb = await box("[data-row-released-on]"), ab = await box("[data-row-amount]");
    expect(Math.abs(rb.y - ab.y)).toBeLessThanOrEqual(4); // side by side, not stacked
    // The status badge right after the due date, on the same line.
    expect(st.x).toBeGreaterThan(due.x + due.width - 1);
    expect(Math.abs((st.y + st.height / 2) - (due.y + due.height / 2))).toBeLessThanOrEqual(4);
  } else {
    // Phone and tablet: the badge at the top right, level with the name, with the due date under it; the
    // transactions under the name and PN; then the branch and the amount released; the release date under those.
    const rowBox = (await row.boundingBox())!;
    expect(st.x + st.width).toBeGreaterThan(rowBox.x + rowBox.width - 24);
    expect(st.y).toBeLessThan(who.y + 12);
    expect(due.y).toBeGreaterThanOrEqual(st.y + st.height - 1);
    expect(Math.abs((due.x + due.width) - (st.x + st.width))).toBeLessThanOrEqual(2);
    expect(txns.y).toBeGreaterThanOrEqual(who.y + who.height - 1);
    expect(branch.y).toBeGreaterThanOrEqual(txns.y + txns.height - 1);
    const amount = await box("[data-row-amount]"), released = await box("[data-row-released-on]");
    expect(Math.abs(amount.y - branch.y)).toBeLessThanOrEqual(4);
    expect(amount.x).toBeGreaterThan(branch.x);
    expect(released.y).toBeGreaterThanOrEqual(branch.y + branch.height - 1);
    expect(Math.abs(released.x - branch.x)).toBeLessThanOrEqual(2);
  }
  // Desktop: column titles like a table, lined up with the row's cells; none on a phone or a tablet.
  const head = page.locator("[data-inbox-pane=mine] [data-inbox-head]");
  if (width(page) >= 1024) {
    await expect(head).toBeVisible();
    await expect(head).toHaveText(/Borrower\s*Branch\s*Transactions\s*Amount\s*Released date\s*Due\s*Time left/);
    const hx = await head.locator("span").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
    expect(Math.abs(hx[1] - Math.round(branch.x))).toBeLessThanOrEqual(2);
    expect(Math.abs(hx[5] - Math.round(due.x))).toBeLessThanOrEqual(2);
  } else {
    await expect(head).toBeHidden();
  }
  // The PN right under the borrower's name, at every width.
  const name = (await row.locator("[data-row-name]").boundingBox())!, pn = (await row.locator("[data-row-pn]").boundingBox())!;
  expect(Math.abs(pn.x - name.x)).toBeLessThan(2);
  expect(pn.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  await shot(page, "inbox-my-items");
  await noSideways(page);
});

test("a late item: the row says Late by N days; the quick filters (Late, Due today, Paused)", async ({ page }) => {
  await openLoan(page);
  const item = await db.workItem.findFirstOrThrow({ where: { pn: PN, kind: "TRANSACTION", state: "HELD" }, orderBy: { arrivedAt: "asc" } });
  await db.workItem.update({ where: { id: item.id }, data: { dueDate: "2026-01-05" } });
  await page.goto("/inbox");
  const row = rows(page, "mine");
  await expect(row.locator("[data-row-status]")).toHaveText(/^Late by \d+ days?$/);
  await expect(row).toHaveAttribute("data-status", "late");
  const filters = page.locator("[data-quick-filters]");
  await expect(filters.locator("[data-quick-filter=late]")).toContainText("Late 1");
  await filters.locator("[data-quick-filter=today]").click();
  await expect(filters.locator("[data-quick-filter=today]")).toHaveAttribute("aria-pressed", "true");
  await expect(row).toHaveCount(0);
  await expect(page.locator("[data-inbox-pane=mine] [data-inbox-empty]")).toHaveText("Nothing matches this filter.");
  await filters.locator("[data-quick-filter=late]").click();
  await expect(row).toHaveCount(1);
  await filters.locator("[data-quick-filter=all]").click();
  await expect(row).toHaveCount(1);
});

test("tabs switch at once: no page load, the tab kept in the address", async ({ page }) => {
  await openLoan(page);
  await page.goto("/inbox");
  await expect(rows(page, "mine")).toHaveCount(1);
  await page.evaluate(() => { (window as unknown as { inboxMark: number }).inboxMark = 42; });
  const asked: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/inbox")) asked.push(r.url()); });
  await page.locator("[data-inbox-tab=pool]").click();
  await expect(rows(page, "pool")).toHaveCount(2);
  await expect(page).toHaveURL(/\/inbox\?tab=pool$/);
  await expect(page.locator("[data-inbox-tab=pool]")).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-inbox-pane=mine]")).toBeHidden();
  await page.locator("[data-inbox-tab=mine]").click();
  await expect(rows(page, "mine")).toBeVisible();
  await expect(page).toHaveURL(/\/inbox\?tab=mine$/);
  expect(await page.evaluate(() => (window as unknown as { inboxMark?: number }).inboxMark)).toBe(42); // the same page
  expect(asked).toEqual([]); // nothing asked of the server
  // The pool row: the badge and how long it has waited, in the same layout.
  const p = page.locator(`[data-inbox-row="${POOL[0]}"]`);
  await page.locator("[data-inbox-tab=pool]").click();
  await expect(p.locator("[data-not-in-dms]")).toBeVisible();
  await expect(p.locator("[data-pool-since]")).toHaveText(/^In the branch pool since [A-Z][a-z]{2} \d{1,2} · (\d+ working days?|less than a day)$/);
  // A pool item has no due date yet: a dash in the Due column on a desktop.
  if (width(page) >= 1024) await expect(p.locator("[data-row-empty=due]")).toBeVisible();
  await shot(page, "inbox-branch-pool");
  await noSideways(page);
});

test("the details panel: opens from the row (mouse and keyboard) without leaving the Inbox; Esc closes and focus goes back", async ({ page }) => {
  await openLoan(page);
  await page.goto("/inbox");
  const row = rows(page, "mine");
  await row.click();
  const dlg = panel(page);
  await expect(dlg).toBeVisible();
  await expect(page).toHaveURL(/\/inbox/);
  // The title says what it is; the borrower's name at the top of the body with the PN right under it.
  await expect(dlg.locator("[data-sheet-header] h2")).toHaveText("Loan details");
  await expect(dlg.locator("[data-panel-name]")).toHaveText("Maria Santos");
  const nm = (await dlg.locator("[data-panel-name]").boundingBox())!, pnb = (await dlg.locator("[data-panel-pn]").boundingBox())!;
  expect(pnb.y).toBeGreaterThanOrEqual(nm.y + nm.height - 1);
  expect(Math.abs(pnb.x - nm.x)).toBeLessThanOrEqual(2);
  await expect(dlg).toContainText(PN);
  await expect(dlg.getByRole("button", { name: `Copy PN ${PN}` })).toBeVisible();
  await expect(dlg.locator("[data-panel-fact=branch]")).toContainText("Antipolo");
  await expect(dlg.locator("[data-panel-fact=product]")).toContainText("Auto Refinancing");
  await expect(dlg.locator("[data-panel-fact=amount]")).toHaveText(/Amount released\s*₱450,000/); // the LA has "See loan amounts"
  await expect(dlg.locator("[data-panel-fact=released]")).toHaveText(/Released date\s*[A-Z][a-z]{2} \d{1,2}, \d{4}/);
  // Each transaction with its step, due date, status and waiting time (only here, not on the row).
  await expect(dlg.locator("[data-panel-item]")).toHaveCount(4);
  const notary = dlg.locator("[data-panel-item=NOTARY]");
  await expect(notary.locator("[data-panel-step]")).toHaveText("Check and send");
  await expect(notary.locator("[data-panel-due]")).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  await expect(notary.locator("[data-panel-waited]")).toHaveText("Less than a day");
  // The cards line up: Step, Due and Waited at the same place in each.
  const dueXs = await dlg.locator("[data-panel-due]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
  expect(new Set(dueXs).size).toBe(1);
  await expect(notary.locator("[data-panel-status]")).toHaveText(/^(Late by \d+ days?|Due today|\d+ days? left)$/);
  await expect(dlg.locator("[data-next-action]")).toHaveText("Check papers");
  await expect(dlg.locator("[data-next-action]")).toHaveAttribute("href", new RegExp(`/loans/${PN}\\?tab=todo&tx=[A-Z]+`));
  await expect(dlg.locator("[data-open-loan]")).toHaveAttribute("href", `/loans/${PN}`);
  // The header (title, X or the grab handle) stays pinned with a line under it; only the body scrolls.
  const header = dlg.locator("[data-sheet-header]"), body = dlg.locator("[data-sheet-body]");
  await expect(header).toHaveCSS("border-bottom-style", "solid");
  const top = (await header.boundingBox())!.y;
  await body.evaluate((e) => { e.scrollTop = e.scrollHeight; });
  expect(Math.abs((await header.boundingBox())!.y - top)).toBeLessThanOrEqual(1);
  await body.evaluate((e) => { e.scrollTop = 0; });
  await shot(page, "inbox-panel");
  // Esc closes; the focus is back on the row.
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(row).toBeFocused();
  // Keyboard: Enter opens it again; the close button (or the grab handle on a phone) closes it.
  await page.keyboard.press("Enter");
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Close" }).filter({ visible: true }).first().click();
  await expect(dlg).toBeHidden();
  await expect(row).toBeFocused();
  // Check papers goes to the transaction.
  await row.click();
  await dlg.locator("[data-next-action]").click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}\\?tab=todo&tx=`));
});

test("arrow keys move between rows; a Branch pool row opens the loan preview card in the panel", async ({ page }) => {
  await signIn(page, "la");
  await page.goto("/inbox?tab=pool");
  const list = rows(page, "pool");
  await expect(list).toHaveCount(2);
  await list.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(list.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(list.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(list.nth(1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(list.first()).toBeFocused();
  // The Financing loan: the preview card (myloans data, the two questions, Open loan file), no Accept.
  await page.locator(`[data-inbox-row="${POOL[0]}"]`).focus();
  await page.keyboard.press("Enter");
  const dlg = panel(page);
  await expect(dlg.locator("[data-find-preview]")).toBeVisible({ timeout: 30_000 });
  // The title says what it is; the borrower's name is said once, at the top of the card.
  await expect(dlg.getByRole("heading", { level: 2 }).first()).toHaveText("Loan preview");
  await expect(dlg.locator("[data-find-source] [data-not-in-dms]")).toBeVisible();
  await expect(dlg.getByText("Is it an Undertaking?")).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Open loan file" })).toBeVisible();
  await expect(dlg.locator("[data-accept]")).toHaveCount(0);
  // Everything the preview page has is in the panel: no link to it; Refresh from myloans updates the card in place.
  await expect(dlg.getByRole("link", { name: /full preview/i })).toHaveCount(0);
  await dlg.locator("[data-refresh-preview]").click();
  await expect(dlg.locator("[data-preview-refreshed]")).toHaveText("Refreshed from myloans just now.");
  await expect(dlg.locator("[data-find-preview]")).toBeVisible();
  await expect(page).toHaveURL(/\/inbox/);
  await expect(dlg.locator("[data-open-cancel]")).toBeHidden(); // the panel closes itself; no Cancel to Loans
  await noSideways(page);
  // Opening it from the panel: the two questions, then Open loan file; the pool item is done.
  await dlg.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await dlg.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await dlg.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${POOL[0]}`));
  await expect.poll(async () => (await db.workItem.findFirstOrThrow({ where: { kind: "LOAN_CANDIDATE", subjectId: POOL[0] } })).state).toBe("DONE");
});

test("the amount only with \"See loan amounts\": without it the panel has none and the server does not send it", async ({ page }) => {
  await openLoan(page);
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  await db.userPermissionOverride.create({ data: { userId: la.id, key: KEY, effect: "DENY", note: "e2e: D-063" } });
  await signIn(page, "la");
  await page.goto("/inbox");
  await rows(page, "mine").click();
  await expect(panel(page).locator("[data-panel-item]")).toHaveCount(4);
  await expect(panel(page).locator("[data-panel-fact=amount]")).toHaveCount(0);
  await expect(rows(page, "mine").locator("[data-row-amount]")).toHaveCount(0);
  // No amount: a dash in its column on a desktop, and in the panel.
  if (width(page) >= 1024) await expect(rows(page, "mine").locator("[data-row-empty=amount]")).toHaveText("-none");
  await expect(panel(page).locator("[data-panel-fact=amount-none]")).toHaveText(/Amount released\s*-/);
  await expect(rows(page, "mine").locator("[data-row-released-on]")).toContainText("Released"); // the date stays
  const r = await page.request.get("/inbox");
  expect(r.status()).toBe(200);
  expect(await r.text()).not.toMatch(AMOUNT);
});

test("Set away in the header: Away until <date>; I am back clears it", async ({ page }) => {
  await signIn(page, "la");
  await page.goto("/inbox");
  await expect(page.locator("main [data-away]")).toHaveCount(0); // the big card is gone (the form is in the sheet)
  const btn = page.locator("[data-set-away]");
  await expect(btn).toHaveText("Set away");
  await btn.click();
  const sheet = page.getByRole("dialog", { name: "Set away" });
  await expect(sheet).toBeVisible();
  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()));
  const [y, m, d] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1, d + 3)).toISOString().slice(0, 10);
  await sheet.getByLabel("Last day away").fill(last);
  await sheet.getByLabel("Note (optional)").fill("Leave");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.locator("[data-away]")).toContainText("Marked away");
  await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } })).awayTo).toBe(last);
  await page.keyboard.press("Escape");
  const until = new Date(`${last}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  await expect(btn).toHaveText(`Away until ${until}`);
  await btn.click();
  await page.getByRole("dialog").getByRole("button", { name: "I am back" }).click();
  await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } })).awayTo).toBeNull();
});

test("every count is in loans, as the rows: the sidebar badge, the tab, waiting too long and Home's card", async ({ page }) => {
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  const branch = await db.branch.findUniqueOrThrow({ where: { code: "101" } });
  const old = new Date(Date.now() - 12 * 86_400_000);
  const item = (n: number, pn: string, state: "INBOX" | "POOL") => db.workItem.create({ data: {
    kind: "TRANSACTION", subjectId: `e2e-count-${pn}-${n}`, role: "LA", branchId: branch.id, pn, label: `${pn}: Notary ${n}`, state,
    holderUserId: state === "INBOX" ? la.id : null, arrivedAt: old,
  } });
  try {
    // Two items given to the LA for ONE loan, and two waiting too long in the pool for ONE other loan.
    await item(1, "GD1012026907701", "INBOX"); await item(2, "GD1012026907701", "INBOX");
    await item(1, "GD1012026907702", "POOL"); await item(2, "GD1012026907702", "POOL");
    await signIn(page, "la");
    await page.goto("/inbox");
    if (width(page) >= 768) await expect(page.locator('#main-sidebar a[href="/inbox"] [data-nav-badge]')).toHaveText("1");
    await expect(page.locator(`[data-inbox-pane=mine] [data-inbox-row="GD1012026907701"] [data-row-txn]`)).toHaveCount(2);
    await expect(page.locator("[data-inbox-tab=mine] [data-tab-count]")).toHaveText("1");
    await expect(page.locator("[data-inbox-tab=pool] [data-tab-red]")).toHaveText("1 waiting too long");
    // Home (the supervisors' card, Admin): one loan, not two items.
    await signIn(page, "admin");
    await page.goto("/dashboard");
    await expect(page.locator("[data-work-counts] [data-pool-too-long]")).toContainText("1 loan waiting in the pool too long");
  } finally {
    await db.workItem.deleteMany({ where: { subjectId: { startsWith: "e2e-count-" } } });
  }
});

test("no sideways scroll from 320 px; a phone row keeps the name and PN whole", async ({ page }) => {
  await openLoan(page);
  await page.setViewportSize({ width: 320, height: 700 });
  for (const t of ["mine", "pool"]) {
    await page.goto(`/inbox?tab=${t}`);
    await expect(rows(page, t).first()).toBeVisible();
    await noSideways(page);
    const cut = await rows(page, t).locator("[data-row-name], [data-row-pn]").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
    expect(cut).toBe(0);
  }
});
