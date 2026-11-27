import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { docShot, signIn, signInWith } from "./helpers";
import { JOB_PN, makeJobs } from "./jobs-fixture";

/**
 * D-064: the DP Jobs page, the same design as Loans and the Inbox: status chips with counts (none chosen: To review
 * and In process, shown as chosen), one search, compact filters that apply at once, one row per job (Borrower with
 * the PN under it, Branch, Transaction and its step, Funds, Sent by, Due, Time left), the details panel with only the
 * actions the processor may do now, the amount only with "See loan amounts", and the sidebar's role on one line.
 * Screenshots: docs/screenshots/ui-refresh/jobs-{default,filter,panel}-<width>.png.
 */
const DIR = "docs/screenshots/ui-refresh";
mkdirSync(DIR, { recursive: true });
const DP = "Continue as Test Document Processor";
const KEY = "loans:view_amounts";
const width = (page: Page) => page.viewportSize()!.width;
const shot = (page: Page, name: string) => docShot(page, { path: `${DIR}/${name}-${width(page)}.png`, fullPage: name !== "jobs-panel" });
const rows = (page: Page) => page.locator("[data-job-row]");
const names = (page: Page) => rows(page).locator("[data-row-name]").allTextContents();
const chip = (page: Page, k: string) => page.locator(`[data-status-option=${k}]`);
const noSideways = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

let jobs: Awaited<ReturnType<typeof makeJobs>>;
test.beforeEach(async () => {
  await resetLoans();
  await db.userPermissionOverride.deleteMany({ where: { key: KEY } });
  jobs = await makeJobs();
});
test.afterAll(async () => {
  await db.userPermissionOverride.deleteMany({ where: { key: KEY } });
  await resetLoans();
});

test("status chips with counts: no tabs; the default is To review and In process; Forwarded and Done when chosen", async ({ page }) => {
  await signInWith(page, DP);
  await page.goto("/jobs");
  const main = page.getByRole("main");
  await expect(main.getByRole("navigation", { name: "Job tabs" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toHaveCSS("font-size", "22px");
  await expect(main).toContainText("Your jobs, least time left first.");
  await page.locator("[data-info-tip=jobs]").hover();
  await expect(page.locator("[data-info-tip-text=jobs] [data-tip-line=review]")).toContainText("To review");
  await page.mouse.move(0, 0);
  for (const [k, on, n] of [["review", true, 1], ["process", true, 2], ["forwarded", false, 1], ["done", false, 1], ["problems", false, 0], ["hold", false, 0]] as const) {
    await expect(chip(page, k)).toHaveAttribute("aria-pressed", String(on));
    await expect(chip(page, k).locator("[data-filter-n]")).toHaveText(String(n));
  }
  // Late first, then the soonest due.
  await expect.poll(() => names(page)).toEqual(["Ben Cruz", "Ana Reyes", "Carla Diaz"]);
  await shot(page, "jobs-default");
  await chip(page, "done").click();
  await expect(page).toHaveURL(/status=review%2Cprocess%2Cdone/);
  await expect(rows(page)).toHaveCount(4);
  await chip(page, "review").click();
  await chip(page, "process").click();
  await expect(page).toHaveURL(/status=done$/);
  await expect.poll(() => names(page)).toEqual(["Ella Santos"]);
  await expect(rows(page).first().locator("[data-time-left]")).toHaveText(/^Done/);
  await noSideways(page);
});

test("one search (name, part of the PN, CIN) and filters that apply at once, in the address", async ({ page }) => {
  await signInWith(page, DP);
  await page.goto("/jobs");
  const box = page.getByRole("searchbox", { name: "Search jobs" });
  await expect(box).toHaveAttribute("placeholder", "Search PN or borrower");
  // As you type, after a short pause (typing can land before the page is interactive: type again if no answer came).
  await expect(async () => {
    const answer = page.waitForResponse((r) => r.url().includes("q=carla"), { timeout: 5_000 });
    await box.fill("");
    await box.fill("carla");
    await answer;
  }).toPass({ timeout: 40_000 });
  await expect(page).toHaveURL(/q=carla/);
  await expect.poll(() => names(page)).toEqual(["Carla Diaz"]);
  await box.fill(JOB_PN("1").slice(-6));
  await box.press("Enter");
  await expect.poll(() => names(page)).toEqual(["Ana Reyes"]);
  await box.fill("CIN-JOB-2");
  await box.press("Enter");
  await expect.poll(() => names(page)).toEqual(["Ben Cruz"]);
  await box.fill("");
  await box.press("Enter");
  await expect(rows(page)).toHaveCount(3);
  // Filters: no Filter button to press; each choice is a new address at once.
  await expect(page.getByRole("button", { name: "Filter", exact: true })).toHaveCount(0);
  await page.locator("[data-more-filters]").click();
  await page.locator("[data-filter=type] select").selectOption("MORTGAGE");
  await expect(page).toHaveURL(/type=MORTGAGE/);
  await expect.poll(() => names(page)).toEqual(["Ben Cruz"]);
  await page.locator("[data-filter=type] select").selectOption("");
  await page.locator("[data-funds-option=needs]").click();
  await expect(page).toHaveURL(/funds=needs/);
  await expect.poll(() => names(page)).toEqual(["Ben Cruz"]);
  await page.locator("[data-funds-option=any]").click();
  await page.locator("[data-filter=late] input").check();
  await expect(page).toHaveURL(/late=1/);
  await expect.poll(() => names(page)).toEqual(["Ben Cruz"]);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-filter-count]")).toHaveText("1");
  await shot(page, "jobs-filter");
  await page.locator("[data-clear-filters]").click();
  await expect(page).toHaveURL(/\/jobs$/);
  // Sort by borrower.
  await page.goto("/jobs?sort=borrower");
  await expect.poll(() => names(page)).toEqual(["Ana Reyes", "Ben Cruz", "Carla Diaz"]);
});

test("rows: the Loans table's layout (Borrower with the PN under it, Branch, Transaction and step, Funds, Sent by, Due, Time left); whole row; nothing cut", async ({ page }) => {
  await signInWith(page, DP);
  await page.goto("/jobs");
  const ben = page.locator(`[data-job-row="${jobs.late.id}"]`);
  await expect(ben.locator("[data-row-name]")).toHaveText("Ben Cruz");
  await expect(ben.locator("[data-row-pn]")).toHaveText(JOB_PN("2"));
  await expect(ben.locator("[data-row-branch]")).toHaveText("Angono");
  await expect(ben.locator("[data-row-txn]")).toContainText("Mortgage");
  await expect(ben.locator("[data-row-step]")).toHaveText("In process");
  await expect(ben.locator("[data-funds=NEEDED]").filter({ visible: true })).toHaveText("Needs funds");
  await expect(ben.locator("[data-row-sent]")).toContainText("Test Loan Associate");
  await expect(ben.locator("[data-row-due]")).toHaveText(/[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  await expect(ben.locator("[data-time-left]")).toHaveText(/^Late by \d+ days?$/);
  await expect(page.locator(`[data-job-row="${jobs.review.id}"] [data-time-left]`)).toHaveText(/^(Due today|\d+ days? left|Day \d+ of \d+)$/);
  await expect(page.locator(`[data-job-row="${jobs.plenty.id}"] [data-time-left]`)).toHaveText(/^(Day \d+ of \d+|\d+ days left)$/);
  await expect(ben.locator("a")).toHaveCount(0);
  const cut = await rows(page).locator("[data-row-name], [data-row-pn]").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(cut).toBe(0);
  const head = page.locator("[data-jobs-head]");
  if (width(page) >= 1024) {
    await expect(head).toHaveText(/Borrower\s*Branch\s*Transaction\s*Funds\s*Sent by\s*Due\s*Time left/);
    expect((await ben.boundingBox())!.height).toBeLessThanOrEqual(56);
  } else {
    await expect(head).toBeHidden();
    // A card: the time left at the top right, level with the name, the due date under it.
    const [who, t, due] = [await ben.locator("[data-row-who]").boundingBox(), await ben.locator("[data-row-time]").boundingBox(), await ben.locator("[data-row-due]").boundingBox()];
    expect(t!.y).toBeLessThan(who!.y + 12);
    expect(due!.y).toBeGreaterThanOrEqual(t!.y + t!.height - 1);
  }
  await noSideways(page);
});

test("the details panel: opens from the row (mouse and keyboard); only the actions the processor may do now; Accept asks first", async ({ page }) => {
  await signInWith(page, DP);
  await page.goto("/jobs");
  const ben = page.locator(`[data-job-row="${jobs.late.id}"]`);
  await ben.click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.locator("[data-sheet-header] h2")).toHaveText("Job details");
  await expect(page).toHaveURL(/\/jobs/);
  await expect(dlg.locator("[data-panel-name]")).toHaveText("Ben Cruz");
  await expect(dlg.locator("[data-panel-pn]")).toHaveText(JOB_PN("2"));
  await expect(dlg.locator("[data-panel-fact=branch]")).toContainText("Angono");
  await expect(dlg.locator("[data-panel-fact=product]")).toContainText("Auto Financing");
  await expect(dlg.locator("[data-panel-fact=sent]")).toContainText("Test Loan Associate");
  await expect(dlg.locator("[data-panel-fact=due]")).toContainText(/\d{4}/);
  await expect(dlg.locator("[data-panel-funds]")).toContainText("Needs funds");
  // In process, late, needs funds: Log attempt and Request funds; no Accept, no Forward.
  await expect(dlg.locator("[data-job-action=attempt]")).toHaveAttribute("href", `/jobs/${jobs.late.id}#work`);
  await expect(dlg.locator("[data-job-action=funds]")).toHaveAttribute("href", "/my-funds");
  await expect(dlg.locator("[data-job-action=accept], [data-job-action=forward], [data-job-action=complete]")).toHaveCount(0);
  await expect(dlg.locator("[data-job-action=open]")).toHaveAttribute("href", `/jobs/${jobs.late.id}`);
  await shot(page, "jobs-panel");
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(ben).toBeFocused();
  // Keyboard: the next row, Enter opens it.
  await page.keyboard.press("ArrowDown");
  const ana = page.locator(`[data-job-row="${jobs.review.id}"]`);
  await expect(ana).toBeFocused();
  await page.keyboard.press("Enter");
  // To review: Accept (asks first) and Review papers; Cancel leaves it, Accept takes it.
  await expect(dlg.locator("[data-job-action=review]")).toHaveAttribute("href", `/jobs/${jobs.review.id}#review`);
  await dlg.locator("[data-job-action=accept]").click();
  const ask = page.locator('[data-confirm-dialog="job-accept-confirm"]');
  await expect(ask.getByRole("heading")).toHaveText("Accept Notary?");
  await ask.locator("[data-confirm-cancel]").click();
  await expect(ask).toBeHidden();
  await expect(dlg).toBeVisible();
  expect((await db.dpAssignment.findUniqueOrThrow({ where: { id: jobs.review.id } })).status).toBe("PENDING_ACCEPTANCE");
  await dlg.locator("[data-job-action=accept]").click();
  await ask.locator("[data-confirm-ok]").click();
  // The panel stays open and shows the job as it is now (In process, with its actions).
  await expect.poll(async () => (await db.dpAssignment.findUniqueOrThrow({ where: { id: jobs.review.id } })).status).toBe("ACCEPTED");
  await expect(dlg.locator("[data-job-action=attempt]")).toBeVisible(); // now In process: its actions
  await page.keyboard.press("Escape");
  // Forwarded: nothing to do but look.
  await page.goto("/jobs?status=forwarded");
  await rows(page).first().click();
  await expect(dlg.locator("[data-job-action=open]")).toBeVisible();
  const kinds = await dlg.locator("[data-job-action]").evaluateAll((els) => els.map((e) => e.getAttribute("data-job-action")));
  expect(kinds.filter((k) => k !== "open" && k !== "loan")).toEqual([]);
  await expect(dlg.locator("[data-job-action=open]")).toBeVisible();
});

test("the amount only with \"See loan amounts\": off for the processor (no column, not sent); on with the tick", async ({ page }) => {
  await signInWith(page, DP);
  await page.goto("/jobs");
  await expect(page.locator("[data-row-amount]")).toHaveCount(0);
  if (width(page) >= 1024) await expect(page.locator("[data-jobs-head]")).not.toContainText("Amount");
  const r = await page.request.get("/jobs");
  expect(await r.text()).not.toMatch(/350,000|350000/);
  const dp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  await db.userPermissionOverride.create({ data: { userId: dp.id, key: KEY, effect: "GRANT", note: "e2e: D-064" } });
  await signInWith(page, DP);
  await page.goto("/jobs");
  if (width(page) >= 1024) {
    await expect(page.locator("[data-jobs-head]")).toContainText("Amount");
    await expect(page.locator(`[data-job-row="${jobs.late.id}"] [data-row-amount]`)).toHaveText("₱350,000");
  }
  await page.locator(`[data-job-row="${jobs.late.id}"]`).click();
  await expect(page.getByRole("dialog").locator("[data-panel-fact=amount]")).toContainText("₱350,000");
});

test("the sidebar's role is on one line for every role, the full name in the tooltip", async ({ page }) => {
  test.skip(width(page) < 1280, "the full sidebar (the rail and the phone menu have no role line)");
  for (const who of [DP, "admin", "la"] as const) {
    if (who === DP) await signInWith(page, DP); else await signIn(page, who);
    await page.goto("/dashboard");
    const role = page.locator("#main-sidebar [data-nav-role]");
    const [h, lh, ws] = await role.evaluate((e) => { const s = getComputedStyle(e); return [e.getBoundingClientRect().height, parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.35, s.whiteSpace]; });
    expect(ws).toBe("nowrap");
    expect(h).toBeLessThanOrEqual(lh + 2);
    const full = (await role.textContent())!.trim();
    await role.hover();
    await expect(page.getByRole("tooltip").filter({ hasText: full })).toBeVisible();
  }
});

const AXE = path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js");
async function axe(page: Page, where: string) {
  await page.addScriptTag({ path: AXE });
  const v = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }[] }> } };
    const r = await w.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
    return r.violations.map((x) => `${x.id} (${x.impact}): ${x.help} at ${x.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
  });
  expect(v, where).toEqual([]);
}

test("accessibility with jobs in the list and with the panel open (WCAG 2.1 AA); 44 px to tap on a phone", async ({ page }) => {
  await signInWith(page, DP);
  await page.goto("/jobs?status=review,process,forwarded,done");
  await expect(rows(page).first()).toBeVisible();
  await axe(page, "/jobs with rows");
  if (width(page) < 768) {
    // The rows, the status chips (with their invisible margin), the Filters and Search buttons: 44 px to tap.
    const small = await page.evaluate(() => [...document.querySelectorAll("[data-job-row], [data-status-option], [data-more-filters], [data-search-submit]")].map((e) => {
      const r = e.getBoundingClientRect();
      const b = getComputedStyle(e, "::before");
      const out = (v: string) => (b.content !== "none" && b.position === "absolute" && v.endsWith("px") ? Math.max(0, -parseFloat(v)) : 0);
      return { what: e.textContent?.trim().slice(0, 20), h: r.height + out(b.top) + out(b.bottom) };
    }).filter((x) => x.h < 44));
    expect(small).toEqual([]);
  }
  await rows(page).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await axe(page, "/jobs with the panel open");
});

test("no sideways scroll from 320 px", async ({ page }) => {
  await signInWith(page, DP);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/jobs?status=review,process,forwarded,done");
  await expect(rows(page).first()).toBeVisible();
  await noSideways(page);
  const cut = await rows(page).locator("[data-row-name], [data-row-pn]").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(cut).toBe(0);
});
