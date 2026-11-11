import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";

/**
 * Monitoring: the DP and LTO monitors (grouped, drill-downs, filters; no CSV for now), refusals, the Send panel's
 * availability chips with a processor on leave and a Full one, the LTO advisory form on a DP job, the
 * warning on the LTO office choice in Check documents, and the Monitoring group in Roles.
 * Screenshots (1440 and 390): docs/screenshots/monitoring/.
 */
const DIR = "docs/screenshots/monitoring";
mkdirSync(DIR, { recursive: true });

const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin", dp: "Continue as Test Document Processor", monitor: "Continue as Test Operations Monitor" } as const;
async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(who === "monitor" ? /\/monitoring/ : /\/dashboard/);
}
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const wide = (page: Page) => width(page) >= 1024;
/** The layout shown at this width: the full table (1024+), the compact table (640 to 1023) or the cards. */
const layout = (page: Page, tab: "dp" | "lto") => page.locator(width(page) >= 1024 ? `[data-${tab}-table]` : width(page) >= 640 ? `[data-${tab}-compact]` : `[data-${tab}-cards]`);
async function shot(page: Page, name: string, fullPage = true) {
  if (![1440, 390].includes(width(page))) return; // 1440 and 390 only
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/${name}-${width(page)}.png`, fullPage });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

const H = 3_600_000, DAY = 86_400_000;
/** Business days before now at 10:00 PHT (weekends skipped; good enough for a fixture). */
function bdAgo(n: number): Date {
  const d = new Date();
  let left = n;
  while (left > 0) { d.setTime(d.getTime() - DAY); const w = new Date(d.getTime() + 8 * H).getUTCDay(); if (w !== 0 && w !== 6) left--; }
  return n === 0 ? new Date(Date.now() - 10 * 60_000) : new Date(`${new Date(d.getTime() + 8 * H).toISOString().slice(0, 10)}T10:00:00+08:00`);
}

let officeQc = "", officeCeb = "", officeMkt = "";
/** A loan with one Notary job in a given state (test fixture: written straight to the test database). */
async function fixtureJob(i: number, o: { branch: string; dp: string; status: "PENDING_ACCEPTANCE" | "ACCEPTED" | "CLOSED" | "DECLINED"; txn: "ASSIGNED" | "IN_PROCESS" | "COMPLETED" | "RETURNED"; sent: Date; accepted?: Date; office: string; stages?: { drop?: Date; pick?: Date; verify?: Date } }) {
  const admin = await db.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  const b = await db.branch.findUniqueOrThrow({ where: { code: o.branch } });
  const dp = await db.user.findUniqueOrThrow({ where: { email: o.dp } });
  const notary = await db.transactionType.findUniqueOrThrow({ where: { code: "NOTARY" } });
  const pn = `GD${o.branch}20269${String(8000 + i).padStart(5, "0")}`;
  const loan = await db.loan.create({
    data: {
      pn, borrowerName: `E2E Monitor ${i}`, branchId: b.id, loanType: "New", productName: "Auto Refinancing", totalReleasedAmount: 400000, releasedAt: o.sent, sourceStatus: "RELEASED",
      retrievedAt: o.sent, openedById: admin.id, classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "E2E fixture", stage: "In process",
    },
  });
  const t = await db.loanTransaction.create({ data: { loanId: loan.id, typeId: notary.id, status: o.txn, statusSince: o.accepted ?? o.sent } });
  const a = await db.dpAssignment.create({
    data: {
      loanId: loan.id, transactionId: t.id, dpBranchId: b.id, dpUserId: dp.id, assignedById: admin.id, ltoOfficeId: o.office, endorsedAt: o.sent, status: o.status,
      decidedAt: o.status === "DECLINED" ? new Date() : o.accepted ?? null, declineReasons: o.status === "DECLINED" ? "No capacity: too many jobs this week." : null, closedAt: o.status === "DECLINED" ? new Date() : null,
    },
  });
  if (o.stages) {
    const s = o.stages;
    const rows = [
      { code: "NOTARIZATION", name: "Notarization", kind: "OWN" as const, sortOrder: 1, at: o.accepted ?? null },
      { code: "LTO_DROP", name: "LTO drop off", kind: "LTO_DROP" as const, sortOrder: 2, at: s.drop ?? null },
      { code: "LTO_PICKUP", name: "LTO pickup", kind: "LTO_PICKUP" as const, sortOrder: 3, at: s.pick ?? null },
      { code: "VERIFY", name: "Check and verify", kind: "VERIFY" as const, sortOrder: 4, at: s.verify ?? null },
    ];
    for (const r of rows) {
      await db.jobStage.create({ data: { assignmentId: a.id, code: r.code, name: r.name, kind: r.kind, sortOrder: r.sortOrder, status: r.at ? "DONE" : "LATER", startedAt: r.at, finishedAt: r.at, startedByLabel: r.at ? dp.name : null, finishedByLabel: r.at ? dp.name : null } });
    }
  }
  return { pn, jobId: a.id };
}

let reportJob = "";
test.beforeEach(async () => {
  // A save from the previous test may still be finishing on the server: try the reset once more.
  await resetLoans().catch(async () => { await new Promise((r) => setTimeout(r, 1_000)); await resetLoans(); });
  await db.ltoAdvisory.deleteMany();
  await db.user.updateMany({ data: { dpCapacity: null, dpOnLeave: false, dpLeaveUntil: null } });
  await db.setting.upsert({ where: { key: "dp.defaultCapacity" }, create: { key: "dp.defaultCapacity", value: 10 }, update: { value: 10 } });
  officeQc = (await db.ltoOffice.findUniqueOrThrow({ where: { code: "LTO-QC" } })).id;
  officeCeb = (await db.ltoOffice.findUniqueOrThrow({ where: { code: "LTO-CEB" } })).id;
  officeMkt = (await db.ltoOffice.findUniqueOrThrow({ where: { code: "LTO-MKT" } })).id;
  await db.ltoOffice.update({ where: { id: officeQc }, data: { distanceKm: 8, suggestedTransportCents: 40000 } });

  // Test DP: at the LTO now (Quezon City), and one waiting 3 business days (overdue).
  reportJob = (await fixtureJob(1, { branch: "101", dp: "test.dp@gdfi.ph", status: "ACCEPTED", txn: "IN_PROCESS", sent: bdAgo(2), accepted: bdAgo(2), office: officeQc, stages: { drop: bdAgo(1) } })).jobId;
  await fixtureJob(2, { branch: "101", dp: "test.dp@gdfi.ph", status: "PENDING_ACCEPTANCE", txn: "ASSIGNED", sent: bdAgo(3), office: officeQc });
  // Rico: two finished jobs with different times.
  await fixtureJob(3, { branch: "101", dp: "dp.rico@gdfi.ph", status: "CLOSED", txn: "COMPLETED", sent: bdAgo(6), accepted: bdAgo(5), office: officeQc, stages: { drop: bdAgo(4), pick: bdAgo(2), verify: bdAgo(1) } });
  await fixtureJob(4, { branch: "101", dp: "dp.rico@gdfi.ph", status: "CLOSED", txn: "COMPLETED", sent: bdAgo(2), accepted: bdAgo(2), office: officeQc, stages: { drop: bdAgo(2), pick: bdAgo(1), verify: bdAgo(1) } });
  // Joy: Full (2 of 2). Paolo (Angono): declined one today.
  await fixtureJob(5, { branch: "101", dp: "dp.joy@gdfi.ph", status: "PENDING_ACCEPTANCE", txn: "ASSIGNED", sent: bdAgo(0), office: officeQc });
  await fixtureJob(6, { branch: "101", dp: "dp.joy@gdfi.ph", status: "ACCEPTED", txn: "IN_PROCESS", sent: bdAgo(1), accepted: bdAgo(0), office: officeQc, stages: {} });
  await fixtureJob(7, { branch: "165", dp: "dp.paolo@gdfi.ph", status: "DECLINED", txn: "RETURNED", sent: bdAgo(0), office: officeCeb });
  await db.user.update({ where: { email: "dp.joy@gdfi.ph" }, data: { dpCapacity: 2 } });
  const until = new Date(Date.now() + 7 * DAY + 8 * H).toISOString().slice(0, 10);
  await db.user.update({ where: { email: "dp.rico@gdfi.ph" }, data: { dpOnLeave: true, dpLeaveUntil: until } });

  // Advisories: active 2 hours ago (Antipolo), older than 24 hours (Angono), resolved (A. Mabini).
  const dp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  const mon = await db.user.findUniqueOrThrow({ where: { email: "test.monitor@gdfi.ph" } });
  await db.ltoAdvisory.create({ data: { ltoOfficeId: officeQc, type: "SYSTEM_DOWN", remarks: "The LTMS terminals are offline.", startedAt: new Date(Date.now() - 2 * H), filedById: dp.id, filedByLabel: dp.name } });
  await db.ltoAdvisory.create({ data: { ltoOfficeId: officeCeb, type: "LONG_QUEUE", remarks: "Queue past the gate every morning.", startedAt: new Date(Date.now() - 50 * H), filedById: mon.id, filedByLabel: mon.name } });
  await db.ltoAdvisory.create({ data: { ltoOfficeId: officeMkt, type: "OFFICE_CLOSED", remarks: "Closed for a seminar.", startedAt: new Date(Date.now() - 26 * H), filedById: dp.id, filedByLabel: dp.name, resolvedAt: new Date(Date.now() - 20 * H), resolvedById: mon.id, resolvedByLabel: mon.name, resolveRemarks: "Open again." } });
});

test.afterAll(async () => {
  await resetLoans();
  await db.ltoAdvisory.deleteMany();
  await db.user.updateMany({ data: { dpCapacity: null, dpOnLeave: false, dpLeaveUntil: null } });
  await db.ltoOffice.update({ where: { code: "LTO-QC" }, data: { distanceKm: null, suggestedTransportCents: null } });
});

test("DP monitor: grouped by area then branch, availability, drill-down without loan links, filters", async ({ page }) => {
  await signInAs(page, "monitor");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Monitoring:");
  await expect(page.getByText("Includes time on hold").first()).toBeVisible();
  // No Home or loan files for this role.
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home", exact: true })).toHaveCount(0);
  const tile = (label: string) => page.locator(`[data-tile="${label}"]`);
  await expect(tile("Assigned")).toContainText("2");
  await expect(tile("Overdue")).toContainText("1");
  const rows = layout(page, "dp");
  const row = (name: string) => rows.locator(`[data-dp-row="${name}"]`);
  await expect(row("Joy Navarro")).toContainText("Full");
  await expect(row("Joy Navarro")).toContainText("2 of 2 in use");
  await expect(row("Rico Dela Cruz")).toContainText(/On leave\s*until/);
  await expect(row("Test Document Processor")).toContainText("2 of 10 in use");
  // Area, then Branch: LUZON 1 (NGMA + RIZAL) > Antipolo (Rico, Joy) and Angono · Antipolo (the test DP). Names only, no codes.
  await expect(rows.locator('[data-group="LUZON 1 (NGMA + RIZAL)"]').first()).toBeVisible();
  await expect(rows.locator('[data-group="LUZON 1 (NGMA + RIZAL)"] [data-branch-group="Antipolo"]').first()).toBeVisible();
  if (wide(page)) {
    await expect(row("Rico Dela Cruz")).toContainText("2 jobs");
    await expect(rows.locator('[data-subtotal="LUZON 1 (NGMA + RIZAL)"]')).toBeVisible();
    await expect(rows.locator('[data-branch-subtotal="Antipolo"]')).toBeVisible();
    await expect(row("Test Document Processor").locator("[data-branch-chips]")).toContainText("Angono");
  }
  await noSideways(page);
  await shot(page, "dp-monitor-grouped");

  // Collapse a group (kept in the URL).
  await rows.locator('[data-group-toggle="LUZON 1 (NGMA + RIZAL)"]').first().click();
  await expect(page).toHaveURL(/hide=luzon-1-ngma-rizal/);
  await expect(row("Joy Navarro")).toHaveCount(0);
  await rows.locator('[data-group-toggle="LUZON 1 (NGMA + RIZAL)"]').first().click();

  // Drill-down: open jobs; the PN is plain text (no loan permission).
  await row("Test Document Processor").getByRole("link", { name: /Test Document Processor/ }).click();
  const sheet = page.getByRole("dialog", { name: "Test Document Processor" });
  await expect(sheet.locator('[data-drill-row="GD1012026908002"]').first()).toContainText("Overdue");
  await expect(sheet.getByRole("link", { name: /GD10120269080/ })).toHaveCount(0);
  await expect(sheet.locator("[data-pn-plain]").first()).toBeVisible();
  await shot(page, "dp-drilldown", false);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();

  // Custom dates (the date range picker: today twice): the heading follows; To before From is refused.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  await page.locator("[data-date-range-button]").click();
  const picker = page.getByRole("dialog", { name: "Date range" });
  await picker.locator(`[data-day="${today}"]`).first().click();
  await picker.locator(`[data-day="${today}"]`).first().click();
  await picker.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(new RegExp(`from=${today}`));
  const d = new Date(`${today}T12:00:00+08:00`);
  const label = `${d.getUTCDate()} ${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} to ${d.getUTCDate()} ${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
  await expect(page.getByRole("heading", { level: 1 })).toContainText(label);
  await page.goto(`/monitoring?tab=dp&range=custom&from=${today}&to=2026-01-01`);
  await expect(page.getByRole("alert").filter({ hasText: "cannot be before" })).toContainText("\"To\" cannot be before \"From\".");

  // The Area filter: processors with any branch in the area (Ben at Alaminos), not the others.
  const l3 = await db.area.findFirstOrThrow({ where: { name: "LUZON 3 NORTH" } });
  await page.goto(`/monitoring?tab=dp&area=${l3.id}`);
  await expect(page.locator("#mf-area")).toHaveValue(l3.id);
  const areaRows = layout(page, "dp");
  await expect(areaRows.locator('[data-dp-row="Ben Ocampo"]')).toBeVisible();
  await expect(areaRows.locator('[data-dp-row="Joy Navarro"]')).toHaveCount(0);

  // By day; no Download CSV (CSV exports are off for now).
  await page.goto("/monitoring?tab=dp&view=day&range=7d");
  await expect(page.locator('[data-by-day="day"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "Download CSV" })).toHaveCount(0);
});

test("LTO monitor: areas, advisories with the 24-hour prompt, drill-down, no amounts without permission", async ({ page }) => {
  await signInAs(page, "monitor");
  await page.goto("/monitoring?tab=lto");
  await expect(page.locator('[data-tile="Jobs at an LTO now"]')).toContainText("1");
  await expect(page.locator('[data-tile="Offices with an active advisory"]')).toContainText("2");
  await expect(page.getByRole("columnheader", { name: "Estimated travel cash" })).toHaveCount(0);
  await expect(page.locator("dt", { hasText: "Estimated travel cash" })).toHaveCount(0);
  const rows = layout(page, "lto");
  const qc = rows.locator('[data-lto-row="LTO Quezon City District Office"]');
  await expect(qc).toContainText("Advisory");
  if (wide(page)) await expect(qc).toContainText("8 km");
  else await expect(qc.locator("dd").filter({ hasText: "8 km" })).toHaveCount(1); // behind Details / More
  await expect(page.locator("[data-stale-prompt]")).toHaveText("Still active? Please confirm");
  await expect(page.locator("[data-advisory-resolved]")).toHaveCount(1);
  await noSideways(page);
  await shot(page, "lto-monitor");

  await qc.getByRole("link", { name: /LTO Quezon City District Office/ }).click();
  const sheet = page.getByRole("dialog", { name: "LTO Quezon City District Office" });
  await expect(sheet.getByRole("region", { name: "At the LTO now" })).toContainText("GD1012026908001");
  await expect(sheet.getByRole("region", { name: "Picked up in the period" })).toContainText("2 business days");
  await shot(page, "lto-drilldown", false);
  await sheet.getByRole("button", { name: "Close" }).click();

  // Resolve the old one (remarks required).
  await page.locator('[data-advisory="Long queue"]').getByRole("button", { name: "No longer active: resolve" }).click();
  const dlg = page.getByRole("dialog", { name: "Resolve the advisory" });
  await expect(dlg.getByRole("button", { name: "Resolve" })).toBeDisabled();
  await dlg.getByLabel(/^Remarks/).fill("Queue is short again.");
  await dlg.getByRole("button", { name: "Resolve" }).click();
  await expect(page.locator('[data-tile="Offices with an active advisory"]')).toContainText("1");
});

test("Refusals: no monitor permission means not found; the CSV address is gone; Admin sees amounts and loan links", async ({ page }) => {
  await signInAs(page, "la");
  const res = await page.goto("/monitoring");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Monitoring" })).toHaveCount(0);
  expect((await page.request.get("/api/monitoring/csv?tab=dp")).status()).toBe(404);
  await signInAs(page, "dp");
  expect((await page.goto("/monitoring?tab=lto"))?.status()).toBe(404);

  await signInAs(page, "admin");
  await page.goto("/monitoring?tab=lto");
  if (wide(page)) await expect(page.getByRole("columnheader", { name: "Estimated travel cash" })).toBeVisible();
  else await expect(layout(page, "lto").locator("dt", { hasText: "Estimated travel cash" }).first()).toBeAttached();
  await page.goto("/monitoring?tab=dp&open=1&dp=" + (await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } })).id);
  await expect(page.getByRole("dialog").getByRole("link", { name: "GD1012026908001" })).toBeVisible();
});

test("DP job at an LTO stage: Report an LTO problem; the warning on the job", async ({ page }) => {
  await signInAs(page, "dp");
  await page.goto(`/jobs/${reportJob}`);
  const box = page.locator("[data-process-at]");
  await expect(box.locator("[data-advisory-warning]")).toContainText("LTO Quezon City District Office: System down, reported by Test Document Processor, 2 h ago");
  await box.getByRole("button", { name: "Report an LTO problem" }).click();
  const dlg = page.getByRole("dialog", { name: "Report an LTO problem" });
  await expect(dlg.getByRole("button", { name: "Report" })).toBeDisabled();
  await dlg.getByRole("radio", { name: "Long queue" }).check();
  await dlg.getByLabel(/^Remarks/).fill("Queue reaches the parking lot.");
  await shot(page, "advisory-form", false);
  await dlg.getByRole("button", { name: "Report" }).click();
  await expect(dlg).toBeHidden();
  await expect.poll(async () => db.ltoAdvisory.count({ where: { type: "LONG_QUEUE", ltoOfficeId: officeQc, resolvedAt: null } })).toBe(1);
  await expect(box.locator("[data-advisory-warning]")).toHaveCount(2);
});

test("Check documents: the Send panel shows availability chips, the processor on leave disabled, Full with a warning, and the LTO advisory", async ({ page }) => {
  await signInAs(page, "la");
  await page.goto("/loans");
  const main = page.getByRole("main");
  await main.getByLabel("Find a loan").fill("GD1012026901001");
  await main.getByRole("button", { name: /^Find/ }).click();
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/GD1012026901001/);
  await page.goto("/loans/GD1012026901001?tab=todo&tx=NOTARY");
  const group = page.getByRole("group", { name: /papers$/ }).first();
  for (const b of await group.getByRole("checkbox").all()) if (!(await b.isChecked())) await b.check();
  const showAll = page.getByRole("button", { name: /^Show all/ });
  if (await showAll.count()) await showAll.click();
  const choice = (n: string) => page.locator(`[data-dp-choice="${n}"]`).filter({ visible: true }).first();
  await expect(choice("Rico Dela Cruz")).toContainText("On leave until");
  await expect(choice("Rico Dela Cruz").locator("input")).toBeDisabled();
  await expect(choice("Joy Navarro")).toContainText("2 of 2");
  await expect(choice("Joy Navarro").locator("[data-availability]")).toHaveText("Full · 0%");
  await expect(choice("Test Document Processor").locator("[data-availability]")).toHaveText("Available · 80%");
  await choice("Joy Navarro").click();
  await expect(page.locator("[data-full-warning]").filter({ visible: true })).toContainText("Joy Navarro is full");
  const lto = page.getByLabel("LTO office", { exact: true }).filter({ visible: true }).first();
  await lto.selectOption({ label: "LTO Quezon City District Office (advisory)" });
  const warn = page.locator("[data-advisory-warning]").filter({ visible: true }).first();
  await expect(warn).toContainText("LTO Quezon City District Office: System down, reported by Test Document Processor");
  await noSideways(page);
  await warn.scrollIntoViewIfNeeded();
  await shot(page, "advisory-warning-check-documents", false);
  await choice("Joy Navarro").scrollIntoViewIfNeeded();
  await shot(page, "send-panel-availability", false);
  await page.waitForLoadState("networkidle");
});

test("Roles: the Monitoring group; Operations Monitor has the two monitors and Manage LTO advisories", async ({ page }) => {
  await signInAs(page, "admin");
  const role = await db.role.findUniqueOrThrow({ where: { key: "MONITOR" } });
  await page.goto(`/admin/settings?open=roles&edit=${role.id}`);
  const g = page.getByRole("region", { name: "Monitoring" });
  await expect(g).toBeVisible();
  const tickOf = (key: string) => page.locator(`[data-perm="${key}"]`).getByRole("checkbox");
  await expect(g.locator('[data-perm="monitor:dp"]').getByRole("checkbox")).toBeChecked();
  await expect(g.locator('[data-perm="monitor:lto"]').getByRole("checkbox")).toBeChecked();
  await expect(g.locator('[data-perm="ltoreports:manage"]').getByRole("checkbox")).toBeChecked();
  await expect(g.locator('[data-perm="ltoreports:notify"]').getByRole("checkbox")).toBeChecked();
  // Filing an advisory from a job is DP work (its own group); the Monitor does not have it.
  await expect(tickOf("ltoreports:create")).not.toBeChecked();
  await g.scrollIntoViewIfNeeded();
  await shot(page, "roles-monitoring-group", false);
  // Settings, Processor capacity.
  await page.goto("/admin/settings?open=dp-capacity");
  await expect(page.locator("[data-default-capacity]")).toBeVisible();
  await expect(page.locator('[data-dp-capacity="Rico Dela Cruz"]')).toContainText("On leave until");
});

// ---------------------------------------------------------------------------------------------------
// Design pass: the date range, the three layouts, the states. Screenshots at 1440, 820 and 390:
// docs/screenshots/monitoring-design/.
// ---------------------------------------------------------------------------------------------------
const DESIGN = "docs/screenshots/monitoring-design";
mkdirSync(DESIGN, { recursive: true });
async function dshot(page: Page, name: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${DESIGN}/${name}-${width(page)}.png`, fullPage });
}
const phtToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const ymdBack = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const words = (from: string, to: string) => {
  const dm = (y: string) => `${Number(y.slice(8, 10))} ${MON[Number(y.slice(5, 7)) - 1]}`;
  return from.slice(0, 4) === to.slice(0, 4) ? `${dm(from)} to ${dm(to)} ${to.slice(0, 4)}` : `${dm(from)} ${from.slice(0, 4)} to ${dm(to)} ${to.slice(0, 4)}`;
};
const focusedDay = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.day ?? null);

test("Design: the date range: keyboard open and close, a preset, then a custom range; title and table follow", async ({ page }) => {
  await signInAs(page, "monitor");
  await page.goto("/monitoring?tab=dp");
  const button = page.locator("[data-date-range-button]");
  await expect(button).toContainText(words(ymdBack(phtToday(), 29), phtToday()));
  // Keyboard: Enter opens with focus on a day; arrow keys move; Esc closes and focus goes back to the button.
  await button.focus();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: "Date range" });
  await expect(picker).toBeVisible();
  await expect.poll(() => focusedDay(page)).toBe(phtToday());
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => focusedDay(page)).toBe(ymdBack(phtToday(), 1));
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(button).toBeFocused();

  // A preset.
  await button.click();
  await expect(picker.locator('[data-preset="30d"]')).toHaveAttribute("aria-pressed", "true");
  await dshot(page, "date-range-open");
  await picker.locator('[data-preset="7d"]').click();
  await expect(picker.locator("[data-range-summary]")).toContainText("7 days,");
  await picker.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/range=7d/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Monitoring: ${words(ymdBack(phtToday(), 6), phtToday())}`);
  await expect(page.locator("[data-reset]")).toHaveCount(1); // Reset: only when a filter is not at its default

  // Custom: two days picked (4 days back to today); the count of days and business days shows.
  const from = ymdBack(phtToday(), 4);
  await button.click();
  if (!(await picker.locator(`[data-day="${from}"]`).isVisible())) await picker.getByRole("button", { name: "Previous month" }).click();
  await picker.locator(`[data-day="${from}"]`).click();
  await expect(picker.locator('[data-preset="custom"]')).toHaveAttribute("aria-pressed", "true");
  if (!(await picker.locator(`[data-day="${phtToday()}"]`).isVisible())) await picker.getByRole("button", { name: "Next month" }).click();
  await picker.locator(`[data-day="${phtToday()}"]`).click();
  await expect(picker.locator("[data-range-summary]")).toContainText(/5 days, \d business days?/);
  await dshot(page, "date-range-custom");
  await picker.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(new RegExp(`range=custom&from=${from}&to=${phtToday()}`));
  const label = words(from, phtToday());
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Monitoring: ${label}`);
  await expect(layout(page, "dp").locator('[data-dp-row="Test Document Processor"]')).toBeVisible();
  // A refresh keeps it (it is in the URL); By day follows the same range.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Monitoring: ${label}`);
  await page.getByRole("link", { name: "By day" }).click();
  await expect(page).toHaveURL(new RegExp(`from=${from}`));
  await expect(page.locator("[data-day-row]").filter({ visible: true }).first()).toBeVisible();
});

test("Design: no sideways scroll on both tabs and By day; tiles, tints and the screenshots", async ({ page }) => {
  await signInAs(page, "monitor");
  await page.goto("/monitoring?tab=dp");
  await expect(page.locator('[data-tile="Overdue"]')).toHaveAttribute("data-tint", "bad");
  await expect(page.locator('[data-tile="Active DPs"]')).toHaveAttribute("data-tint", "none");
  // Zero is neutral grey: Joy has nothing overdue.
  await expect(layout(page, "dp").locator('[data-dp-row="Joy Navarro"] [data-tone="zero"]').filter({ visible: true }).first()).toBeVisible();
  await noSideways(page);
  await dshot(page, "dp-totals", true);
  await page.goto("/monitoring?tab=dp&view=day&range=7d");
  await expect(page.locator('[data-by-day="day"]')).toBeVisible();
  await noSideways(page);
  await dshot(page, "dp-by-day", true);
  await page.goto("/monitoring?tab=lto");
  await expect(layout(page, "lto").locator('[data-lto-row="LTO Quezon City District Office"]')).toContainText("Advisory");
  await noSideways(page);
  await dshot(page, "lto-totals", true);
  await page.goto("/monitoring?tab=lto&view=day");
  await noSideways(page);
});

test("Design: 820 Details and 390 More open inline; the 390 card shows the same numbers as the 1440 table", async ({ page }) => {
  await signInAs(page, "monitor");
  const w = width(page);
  // The main numbers of one processor in the 1440 table.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/monitoring?tab=dp");
  const cells = page.locator('[data-dp-table] [data-dp-row="Test Document Processor"] td');
  const fromTable: string[] = [];
  for (let i = 0; i < 4; i++) fromTable.push((await cells.nth(i).innerText()).trim());
  const declined = (await cells.nth(4).innerText()).trim();

  await page.setViewportSize({ width: 820, height: 1180 });
  const compact = page.locator('[data-dp-compact] [data-dp-row="Test Document Processor"]');
  await expect(compact).toBeVisible();
  for (let i = 0; i < 4; i++) await expect(compact.locator("td").nth(i)).toHaveText(fromTable[i]);
  await compact.locator("[data-details] summary").click();
  await expect(compact.locator("[data-details] dl")).toBeVisible();
  await expect(compact.locator("[data-details] dl")).toContainText("Avg time to accept");
  await expect(compact.locator("[data-details] dd").first()).toHaveText(declined);
  await noSideways(page);
  if (w === 820) await dshot(page, "details-open");

  await page.setViewportSize({ width: 390, height: 844 });
  const card = page.locator('[data-dp-cards] [data-dp-row="Test Document Processor"]');
  await expect(card).toBeVisible();
  for (const [i, k] of ["Assigned", "In process", "On hold", "Overdue"].entries()) await expect(card.locator(`[data-count="${k}"] dd`)).toHaveText(fromTable[i]);
  await expect(card).toContainText("2 of 10 in use");
  await card.locator("[data-more] summary").click();
  await expect(card.locator("[data-more] dl")).toContainText("Avg total");
  await expect(card.locator("[data-more] dd").first()).toHaveText(declined);
  await noSideways(page);
  if (w === 390) { await card.scrollIntoViewIfNeeded(); await dshot(page, "card-more-open"); }

  // 390: the filters collapse into one Filters button (with a count) and a bottom sheet; the date range stays next to it.
  await expect(page.locator("#mf-area")).toBeHidden();
  await expect(page.locator("[data-date-range-button]")).toBeVisible();
  const l1 = await db.area.findFirstOrThrow({ where: { name: "LUZON 1 (NGMA + RIZAL)" } });
  await page.goto(`/monitoring?tab=dp&area=${l1.id}`);
  await expect(page.locator("[data-filter-count]")).toHaveText(/^1/);
  await page.locator("[data-filters-button]").click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet.getByLabel("Area")).toHaveValue(l1.id);
  await expect(sheet.getByRole("button", { name: "Apply" })).toBeVisible();
  if (w === 390) await dshot(page, "filters-sheet");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.setViewportSize({ width: w, height: w === 1440 ? 900 : w === 820 ? 1180 : 844 });
});

test("Design: an empty period: a calm message and Last 30 days", async ({ page }) => {
  await signInAs(page, "monitor");
  await page.goto("/monitoring?tab=dp&range=custom&from=2026-01-05&to=2026-01-06");
  const empty = page.locator("[data-empty]").first();
  await expect(empty).toContainText("No jobs in this period. Try a wider date range.");
  await noSideways(page);
  await dshot(page, "empty-state");
  await empty.getByRole("link", { name: "Last 30 days" }).click();
  await expect(page).not.toHaveURL(/from=2026-01-05/);
  await expect(page.locator("[data-date-range-button]")).toContainText(words(ymdBack(phtToday(), 29), phtToday()));
});
