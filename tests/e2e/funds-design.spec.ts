import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanTestRoles, db, resetLoans } from "./db";

/**
 * Funds page design pass: tabs with count pills, the one-line summary, the type filter and the search,
 * one row per request (a table at 1440, a two-line row with Details at 820, a card at 390), the single
 * "You can view these requests" line for a view-only role, the empty states, no sideways page scroll.
 * The Manual Test Kit's Funds samples live in gdfi_dms only, so the same kinds of records (a Cash advance
 * for an LTO fee with its office, an "Other: Courier" Fund transfer, one approved, one sent, two closed)
 * are made here in gdfi_dms_test. Screenshots to docs/screenshots/funds-design/ (1440, 820 and 390 px).
 */
const DIR = "docs/screenshots/funds-design";
mkdirSync(DIR, { recursive: true });
const BUTTONS = { fin: "Continue as Test Finance" } as const;
const OFFICE = "Z-DESIGN";
const PN1 = "GD1012026990001";

const width = (page: Page) => page.viewportSize()?.width ?? 0;
async function shot(page: Page, name: string, target?: Locator) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0); // never a loading placeholder
  const path = `${DIR}/${name}-${width(page)}.png`;
  if (target) await target.screenshot({ path });
  else await page.screenshot({ path, fullPage: true });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
async function signInFinance(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS.fin }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
const row = (page: Page, number: string) => page.locator(`[data-advance="${number}"]`);

/**
 * The row's buttons: one line (same top within 2 px), 32 px high on desktop and tablet, at least 44 px on a
 * phone; on desktop the Action cell is no taller than the row's other cells (the buttons never grow the row).
 */
async function rowButtons(page: Page, number: string, n: number) {
  const act = row(page, number).locator(".fl-act");
  const buttons = act.locator("button, a").filter({ visible: true });
  await expect(buttons).toHaveCount(n);
  const boxes = await Promise.all((await buttons.all()).map((b) => b.boundingBox()));
  const tops = boxes.map((b) => b!.y);
  if (width(page) !== 390) expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
  for (const b of boxes) {
    if (width(page) === 390) expect(b!.height).toBeGreaterThanOrEqual(44);
    else expect(Math.round(b!.height)).toBe(32);
  }
  if (width(page) === 1440) {
    const others = await Promise.all([".fl-req", ".fl-loan", ".fl-for", ".fl-asked"].map(async (c) => (await row(page, number).locator(c).boundingBox())!.height));
    expect((await act.boundingBox())!.height).toBeLessThanOrEqual(Math.max(...others));
  }
}

async function clean() {
  await resetLoans();
  await cleanTestRoles();
  await db.loan.deleteMany({ where: { pn: { startsWith: "GD10120269900" } } });
  await db.ltoOffice.deleteMany({ where: { code: OFFICE } });
}

/** The sample records (same shapes as the kit's Funds samples). */
async function fixtures() {
  const branch = await db.branch.findUniqueOrThrow({ where: { code: "101" } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  const dp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  const fin = await db.user.findUniqueOrThrow({ where: { email: "test.finance@gdfi.ph" } });
  const ft = await db.fundsType.findUniqueOrThrow({ where: { code: "FT" } });
  const mortgage = await db.transactionType.findUniqueOrThrow({ where: { code: "MORTGAGE" } });
  const office = await db.ltoOffice.create({ data: { code: OFFICE, name: "Z LTO Design District Office", city: "Quezon City", distanceKm: 8, travelHours: 1, suggestedTransportCents: 40_000 } });
  const loan = (pn: string, borrowerName: string) => db.loan.create({
    data: {
      pn, borrowerName, branchId: branch.id, loanType: "New", productName: "Auto Financing", totalReleasedAmount: 400000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: admin.id,
      classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "E2E fixture", stage: "For checklist", transactions: { create: { typeId: mortgage.id } },
    },
    include: { transactions: true },
  });
  const l1 = await loan(PN1, "Elsa Morales");
  const l2 = await loan("GD1012026990002", "Fidel Herrera");
  const l3 = await loan("GD1012026990003", "Gloria Chua");
  const base = { requestedById: dp.id, branchId: branch.id };
  const asFt = { fundsTypeId: ft.id, fundsTypeCode: "FT", fundsTypeName: ft.name };
  const day = 86_400_000;
  // To approve: a Cash advance (LTO fee at the office + transport) and a Fund transfer for "Other: Courier" (a general expense: no loan).
  await db.cashAdvance.create({ data: { ...base, number: "CA-2026-7001", requestedCents: 390_000, lines: { create: [
    { transactionId: l1.transactions[0].id, kind: "LTO_FEE", requestedCents: 350_000, ltoOfficeId: office.id },
    { transactionId: l1.transactions[0].id, kind: "TRANSPORT", requestedCents: 40_000, presetCents: 40_000, amountSource: "OFFICE", ltoOfficeId: office.id },
  ] } } });
  await db.cashAdvance.create({ data: { ...base, ...asFt, number: "FT-2026-7002", requestedCents: 25_000, lines: { create: [{ kind: "OTHER", otherDescription: "Courier", requestedCents: 25_000 }] } } });
  // To release: approved by Test Finance.
  await db.cashAdvance.create({ data: { ...base, number: "CA-2026-7003", status: "APPROVED", requestedCents: 300_000, approvedCents: 300_000, approvedById: fin.id, approvedAt: new Date(), lines: { create: [{ transactionId: l2.transactions[0].id, kind: "LTO_FEE", requestedCents: 300_000, approvedCents: 300_000 }] } } });
  // Outstanding: a transfer sent 5 days ago, liquidation overdue, one receipt.
  const sent = await db.cashAdvance.create({ data: { ...base, ...asFt, number: "FT-2026-7004", status: "RELEASED", requestedCents: 250_000, approvedCents: 250_000, releasedCents: 250_000, approvedById: fin.id, approvedAt: new Date(Date.now() - 6 * day), releasedById: fin.id, releasedAt: new Date(Date.now() - 5 * day), liquidationDueAt: new Date(Date.now() - day), releaseRef: "FT-887004", transferDate: "2026-11-02", accountProvider: "BPI", accountName: "Test Document Processor", accountLast4: "4821", overdueNotifiedAt: new Date(), lines: { create: [{ transactionId: l3.transactions[0].id, kind: "LTO_FEE", requestedCents: 250_000, approvedCents: 250_000, releasedCents: 250_000 }] } }, include: { lines: true } });
  await db.receipt.create({ data: { lineId: sent.lines[0].id, date: "2026-11-03", cents: 100_000, number: "OR-5521", uploadedById: dp.id } });
  // History: one closed, one denied.
  await db.cashAdvance.create({ data: { ...base, number: "CA-2026-7005", status: "CLOSED", requestedCents: 150_000, approvedCents: 150_000, releasedCents: 150_000, releasedAt: new Date(Date.now() - 9 * day), closedAt: new Date(Date.now() - day), lines: { create: [{ kind: "TRANSPORT", requestedCents: 150_000, note: "Tricycle to the LTO" }] } } });
  await db.cashAdvance.create({ data: { ...base, number: "CA-2026-7006", status: "DENIED", requestedCents: 80_000, deniedReason: "Not needed for this job", lines: { create: [{ kind: "TRANSPORT", requestedCents: 80_000, note: "Grab to the branch" }] } } });
}

test.beforeEach(async () => {
  await clean();
  await fixtures();
});
test.afterAll(clean);

test("Tabs, summary, type filter and search; each row shows the same values at every width", async ({ page }) => {
  test.setTimeout(180_000);
  const keyWarnings: string[] = [];
  page.on("console", (m) => { if (/unique "key"/.test(m.text())) keyWarnings.push(m.text().slice(0, 1500)); });
  await signInFinance(page);
  await page.goto("/funds?tab=approve");
  const tabs = page.locator("[data-funds-tabs]");
  await expect(tabs.locator('[data-tab="approve"] [data-tab-count]')).toHaveText("2");
  await expect(tabs.locator('[data-tab="release"] [data-tab-count]')).toHaveText("1");
  await expect(tabs.locator('[data-tab="outstanding"] [data-tab-count]')).toHaveText("1");
  await expect(tabs.locator('[data-tab="history"] [data-tab-count]')).toHaveText("2");
  await expect(tabs.locator('[aria-current="page"]')).toHaveAttribute("data-tab", "approve");
  await expect(page.locator("[data-funds-summary]")).toHaveText("2 requests · ₱4,150.00 total");

  // One Cash advance and one Fund transfer, column by column (the same values at 1440, 820 and 390).
  const ca = row(page, "CA-2026-7001");
  await expect(ca.locator("[data-request-number]")).toHaveText("CA-2026-7001");
  await expect(ca.locator('[data-funds-type="CA"]')).toBeVisible();
  await expect(ca.locator("[data-loan-borrower]")).toHaveText("Elsa Morales");
  await expect(ca.locator("[data-loan-pn]")).toHaveText(PN1);
  await expect(ca.locator(".fl-loan")).toContainText("Mortgage");
  await expect(ca.locator("[data-amount]")).toHaveText("₱3,900.00");
  await expect(ca.locator(".fl-amt")).not.toContainText("Suggested"); // only the transport line has a suggested amount
  await expect(ca.locator(".fl-status")).toContainText("Waiting for approval");
  await expect(ca.locator(".fl-status")).toContainText("Waiting since today");
  await expect(ca.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await expect(ca.getByRole("button", { name: "Deny", exact: true })).toBeVisible();
  const fty = row(page, "FT-2026-7002");
  await expect(fty.locator('[data-funds-type="FT"]')).toBeVisible();
  await expect(fty.locator("[data-amount]")).toHaveText("₱250.00");
  await expect(fty.locator(".fl-loan")).toHaveText(/—/); // a general expense: no loan, a grey dash

  // For and Asked by: on a tablet they open with the row's Details chevron.
  if (width(page) === 820) {
    await expect(ca.locator(".fl-for")).toBeHidden();
    await expect(page.locator(".fl-head")).toContainText("Amount");
    await ca.getByRole("button", { name: "Show details of CA-2026-7001" }).click();
    await expect(ca.locator(".fl-for")).toBeVisible();
    await shot(page, "details-open", ca);
  }
  await expect(ca.locator("[data-kind-text]")).toHaveText(["LTO fee", "Transport"]);
  await expect(ca.locator(".fl-for")).toContainText("Z LTO Design District Office · about 8 km · usually 1 hour · suggested transport ₱400");
  await expect(ca.locator(".fl-for")).toContainText("₱3,500.00");
  await expect(ca.locator(".fl-asked")).toContainText("Test Document Processor");
  await expect(ca.locator(".fl-asked")).toContainText("Antipolo");
  if (width(page) === 820) await ca.getByRole("button", { name: "Hide details of CA-2026-7001" }).click();
  else {
    await expect(ca.locator(".fl-for")).toBeVisible();
    await expect(fty.locator("[data-kind-text]")).toHaveText("Other: Courier");
  }
  await expect(page.locator("[data-view-only]")).toHaveCount(0);
  await noSideways(page);
  await rowButtons(page, "CA-2026-7001", 3);

  // More: three dots, a list in a portal, arrow keys, Esc returns focus; a bottom sheet on a phone.
  const dots = ca.getByRole("button", { name: "More actions" });
  await dots.click();
  const menu = page.locator("[data-more-menu]");
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((el) => el.parentElement === document.body)).toBe(true);
  const vp = page.viewportSize()!;
  const mb = (await menu.boundingBox())!;
  expect(mb.y).toBeGreaterThanOrEqual(0);
  expect(mb.y + mb.height).toBeLessThanOrEqual(vp.height + 1);
  expect(mb.x + mb.width).toBeLessThanOrEqual(vp.width + 1);
  await expect(menu.getByRole("button").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("button").nth(1)).toBeFocused();
  const items = menu.getByRole("button");
  if (width(page) === 390) {
    expect(Math.round(mb.y + mb.height)).toBe(vp.height); // the bottom sheet
    expect((await items.first().boundingBox())!.height).toBeGreaterThanOrEqual(48);
  } else {
    const db0 = (await dots.boundingBox())!;
    expect(Math.round(db0.width)).toBe(32);
    expect(Math.round(db0.height)).toBe(32);
    expect(Math.abs(mb.x + mb.width - (db0.x + db0.width))).toBeLessThanOrEqual(1); // right edges aligned
    expect((await items.first().boundingBox())!.height).toBeGreaterThanOrEqual(36);
  }
  await shot(page, "to-approve");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(dots).toBeFocused();
  if (width(page) !== 390) {
    // Near the bottom of the screen the list opens upward.
    await page.evaluate(() => window.scrollTo(0, 0));
    const d = (await dots.boundingBox())!;
    await page.setViewportSize({ width: vp.width, height: Math.ceil(d.y + d.height + 24) });
    await dots.click();
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("data-flipped", "true");
    const up = (await menu.boundingBox())!;
    expect(up.y + up.height).toBeLessThanOrEqual((await dots.boundingBox())!.y);
    await page.keyboard.press("Escape");
    await page.setViewportSize(vp);
  }

  // The type filter (server) and the search (on the page).
  await page.locator('[data-filter-type="FT"]').click();
  await expect(page).toHaveURL(/ftype=FT/);
  await expect(page.locator("[data-advance]")).toHaveCount(1);
  await expect(page.locator("[data-funds-summary]")).toHaveText("1 request · ₱250.00 total");
  await expect(page.locator('[data-filter-type="FT"] [data-type-count]')).toHaveText("1");
  await page.locator("[data-funds-type-filter]").getByRole("link", { name: /^All/ }).click();
  await expect(page.locator("[data-advance]")).toHaveCount(2);
  const search = page.locator("[data-funds-search]");
  await search.fill("elsa");
  await expect(row(page, "CA-2026-7001")).toBeVisible();
  await expect(row(page, "FT-2026-7002")).toBeHidden();
  await expect(page.locator("[data-funds-summary]")).toContainText("1 request · ₱3,900.00 total");
  await search.fill(PN1.slice(-6));
  await expect(page.locator("[data-funds-summary]")).toContainText("1 request");
  await search.fill("ft-2026-7002");
  await expect(row(page, "FT-2026-7002")).toBeVisible();
  await expect(row(page, "CA-2026-7001")).toBeHidden();
  await search.fill("nobody at all");
  await expect(page.getByText("No request matches “nobody at all”.")).toBeVisible();
  await search.fill("");

  // To release: Approved by and the approved amount; Release opens the form.
  await page.goto("/funds?tab=release");
  const rel = row(page, "CA-2026-7003");
  await expect(rel.locator("[data-amount]")).toHaveText("₱3,000.00");
  await expect(rel.locator(".fl-amt")).toContainText("Approved by Test Finance");
  await expect(page.locator("[data-funds-summary]")).toHaveText("1 request · ₱3,000.00 total");
  await expect(rel.getByRole("button", { name: "Release", exact: true })).toBeVisible();
  await rowButtons(page, "CA-2026-7003", 2);
  await noSideways(page);
  await shot(page, "to-release");

  // Outstanding: the money trail, the balance in amber, the aging dot with words.
  await page.goto("/funds?tab=outstanding");
  const out = row(page, "FT-2026-7004");
  await expect(out.locator("[data-amount]")).toHaveText("₱1,500.00");
  await expect(page.locator("[data-funds-summary]")).toHaveText("1 request · ₱1,500.00 total");
  if (width(page) === 820) await out.getByRole("button", { name: "Show details of FT-2026-7004" }).click();
  await expect(out.locator("[data-released]")).toHaveText("₱2,500.00");
  await expect(out.locator("[data-liquidated]")).toHaveText("₱1,000.00");
  await expect(out.locator("[data-balance]")).toHaveText("₱1,500.00");
  await expect(out.locator('[data-money-trail] [data-aging="bad"]')).toContainText("business days outstanding");
  await expect(out).toContainText("account ending 4821");
  await expect(out.locator(".fl-status")).toContainText("Liquidation overdue");
  await noSideways(page);
  if (width(page) === 390) {
    await out.getByRole("button", { name: "Show details of FT-2026-7004" }).click();
    await expect(out.getByText("OR-5521", { exact: false })).toBeVisible();
    await shot(page, "card-more", out);
  }
  await shot(page, "outstanding");

  expect(keyWarnings, keyWarnings.join(" | ")).toEqual([]);

  // History: the outcome and the closed date; Print in the row's Action column where a report exists.
  await page.goto("/funds?tab=history");
  const closed = row(page, "CA-2026-7005");
  await expect(closed.locator(".fl-status")).toContainText("Closed");
  await expect(row(page, "CA-2026-7006").locator(".fl-status")).toContainText("Denied");
  await expect(row(page, "CA-2026-7006").getByRole("link", { name: "Print" })).toHaveCount(0);
  await expect(row(page, "CA-2026-7006").locator(".fl-act")).toHaveCount(0);
  const print = closed.getByRole("link", { name: "Print" });
  await expect(print).toBeVisible();
  const [rb, pb] = [(await closed.boundingBox())!, (await print.boundingBox())!];
  const mid = pb.y + pb.height / 2;
  expect(mid).toBeGreaterThan(rb.y);
  expect(mid).toBeLessThan(rb.y + rb.height);
  if (width(page) === 390) expect(pb.height).toBeGreaterThanOrEqual(44);
  else expect(Math.round(pb.height)).toBe(32);
  if (width(page) === 1440) {
    await expect(page.locator(".fl-head .h-act")).toHaveText("Action");
    const h = (await page.locator(".fl-head .h-act").boundingBox())!;
    expect(pb.x).toBeGreaterThanOrEqual(h.x - 1);
    expect(pb.x + pb.width).toBeLessThanOrEqual(h.x + h.width + 1);
  }
  await expect(page.locator("[data-funds-summary]")).toHaveText("2 requests · ₱2,300.00 total");
  await noSideways(page);
  await shot(page, "history");
});

test("A view-only role sees one calm line, not a line per row; empty tabs say so", async ({ page }) => {
  const role = await db.role.create({ data: { key: "C_Z_FUNDS_VIEW", name: "Z Funds viewer", builtIn: false, permissions: ["loans:view", "funds:ca_view", "funds:ft_view"] } });
  await db.user.create({ data: { email: "zz.fundsviewer@gdfi.ph", name: "Zz Funds Viewer", roleId: role.id, isTestUser: true, allBranches: true } });
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Other test user").selectOption({ label: "Zz Funds Viewer (Z Funds viewer)" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  for (const tab of ["approve", "release", "outstanding"]) {
    await page.goto(`/funds?tab=${tab}`);
    await expect(page.locator("[data-view-only]")).toHaveCount(1);
    await expect(page.locator("[data-row-lock]")).toHaveCount(0);
    await expect(page.getByText("You can view only.")).toHaveCount(0);
    await noSideways(page);
    if (tab === "approve") {
      await expect(page.locator("[data-view-only]")).toHaveText("You can view these requests. Approving cash advances needs the 'Approve cash advances' tick on your role. Approving fund transfers needs the 'Approve fund transfers' tick on your role.");
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
      await shot(page, "view-only");
    }
  }

  // Empty: nothing anywhere.
  await db.receipt.deleteMany({});
  await db.cashAdvanceLine.deleteMany({});
  await db.cashAdvance.deleteMany({});
  await page.goto("/funds?tab=approve");
  await expect(page.locator("[data-funds-empty]")).toHaveText("Nothing is waiting for approval.");
  await expect(page.locator("[data-funds-summary]")).toHaveText("0 requests · ₱0.00 total");
  await expect(page.locator("[data-view-only]")).toHaveCount(0);
  await noSideways(page);
  await shot(page, "empty-state");
  await page.goto("/funds?tab=history");
  await expect(page.locator("[data-funds-empty]")).toHaveText("No closed requests yet.");
});

test("A liquidated request has Print: the liquidation report in the GDFI print format", async ({ page }) => {
  // FT-2026-7004 fully liquidated: a second receipt covers the balance.
  const adv = await db.cashAdvance.update({ where: { number: "FT-2026-7004" }, data: { status: "LIQUIDATED" }, include: { lines: true, requestedBy: true } });
  await db.receipt.create({ data: { lineId: adv.lines[0].id, date: "2026-11-05", cents: 150_000, number: "OR-5522", uploadedById: adv.requestedById } });
  await signInFinance(page);
  await page.goto("/funds?tab=outstanding");
  const out = row(page, "FT-2026-7004");
  await expect(out.getByRole("button", { name: "Close advance" })).toBeVisible();
  await expect(out.getByRole("link", { name: "Print" })).toBeVisible();
  await noSideways(page);
  await out.getByRole("link", { name: "Print" }).click();
  await expect(page).toHaveURL(/\/funds\/FT-2026-7004\/print$/);
  // The title is fully visible under the top bar when the page opens.
  const title = page.getByRole("heading", { name: "Liquidation report", level: 1 });
  await expect(title).toBeVisible();
  const bar = (await page.getByRole("banner").filter({ visible: true }).first().boundingBox())!;
  expect((await title.boundingBox())!.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);

  const report = page.locator('[data-liquidation-report="FT-2026-7004"]');
  await expect(report).toContainText("Liquidation report");
  await expect(report).toContainText("Global Dominion Financing, Inc.");
  await expect(report).toContainText("FT · Fund transfer · Liquidated");
  await expect(report).toContainText("Test Document Processor");
  await expect(report).toContainText("account ending 4821");
  await expect(report.getByRole("cell", { name: "OR-5521" })).toBeVisible();
  await expect(report.getByRole("cell", { name: "OR-5522" })).toBeVisible();
  // Exactly one divider under the header, 16 px clear above and below, and no rule on the header itself.
  await expect(report.locator("[data-report-divider]")).toHaveCount(1);
  await expect(report.locator("[data-report-header]")).toHaveCSS("border-bottom-width", "0px");
  const hd = (await report.locator("[data-report-header]").boundingBox())!;
  const dv = (await report.locator("[data-report-divider]").boundingBox())!;
  const grid = (await report.locator("dl").first().boundingBox())!;
  expect(Math.round(dv.height)).toBe(2);
  await expect(report.locator("[data-report-divider]")).toHaveCSS("background-color", "rgb(12, 35, 64)"); // solid navy on screen
  await expect(report.locator("[data-report-divider]")).toHaveCSS("background-image", "none");
  expect(dv.y - (hd.y + hd.height)).toBeGreaterThanOrEqual(15.5);
  expect(grid.y - (dv.y + dv.height)).toBeGreaterThanOrEqual(15.5);
  // No two horizontal rules touch or overlap (table cell rows aside: each row has its own line).
  const lines = await report.evaluate((root) => {
    const out: { y: number; x1: number; x2: number; what: string }[] = [];
    for (const el of root.querySelectorAll<HTMLElement>("*")) {
      if (el.tagName === "TD") continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const what = `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`;
      if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") out.push({ y: r.top, x1: r.left, x2: r.right, what: `${what} top` });
      if (parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== "none") out.push({ y: r.bottom, x1: r.left, x2: r.right, what: `${what} bottom` });
      if (el.hasAttribute("data-report-divider")) out.push({ y: r.top, x1: r.left, x2: r.right, what: "divider" });
    }
    return out;
  });
  const overlaps = lines.flatMap((a, i) => lines.slice(i + 1).filter((b) => Math.abs(a.y - b.y) < 3 && a.x1 < b.x2 && b.x1 < a.x2 && !(a.what.startsWith("th") && b.what.startsWith("th"))).map((b) => `${a.what} / ${b.what}`));
  expect(overlaps).toEqual([]);
  const totals = report.locator("[data-print-totals]");
  await expect(totals).toContainText("₱2,500.00");
  await expect(report.locator("[data-print-balance]")).toHaveText("₱0.00");
  await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
  await noSideways(page);
  await shot(page, "print-report");
  // What the printer gets: the report only, no app bars or buttons.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Back to Funds" })).toBeHidden();
  // On paper the divider is one solid black line (no gold segment).
  await expect(report.locator("[data-report-divider]")).toHaveCSS("background-image", "none");
  await expect(report.locator("[data-report-divider]")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await shot(page, "print-preview");
  // The A4 PDF (print styles): one page for this sample, named after the request.
  const pdfBytes = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
  mkdirSync("test-results", { recursive: true });
  writeFileSync(`test-results/liquidation-report-${width(page)}.pdf`, pdfBytes);
  const pdf = pdfBytes.toString("latin1");
  expect(pdf.match(/\/Type\s*\/Page(?!s)/g)?.length).toBe(1);
  const hex = Buffer.from("FT-2026-7004", "utf16le").swap16().toString("hex").toUpperCase();
  expect(pdf.includes("FT-2026-7004") || pdf.toUpperCase().includes(hex)).toBe(true);
  await page.emulateMedia({ media: "screen" });

  // A request that is not liquidated has no report.
  await page.goto("/funds/CA-2026-7001/print");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  await expect(page.locator("[data-liquidation-report]")).toHaveCount(0);
});
