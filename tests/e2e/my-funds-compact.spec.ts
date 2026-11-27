import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { docShot, signInWith } from "./helpers";
import { cleanFunds, FNUM, FPN, makeFunds } from "./funds-fixture";

/**
 * D-065: the processor's My funds, the same design as Loans and Jobs: one list (a row per job that needs funds and per
 * advance line), the status choices in Filters ("All open" by default), one search, Filters at once, rows like the
 * Loans table, Request funds in the side panel (one or several jobs; compact lines; Other's description only with an
 * amount; over the maximum needs a reason; totals; Send asks first; the overdue block and Finance's exception), and
 * the advance's panel (FT receipt confirmation with a mismatch; the liquidation with the change to return).
 * Screenshots: docs/screenshots/ui-refresh/my-funds-{default,request,panel}-<width>.png.
 */
const DIR = "docs/screenshots/ui-refresh";
mkdirSync(DIR, { recursive: true });
const DP = "Continue as Test Document Processor";
const width = (page: Page) => page.viewportSize()!.width;
const shot = (page: Page, name: string) => docShot(page, { path: `${DIR}/${name}-${width(page)}.png`, fullPage: name === "my-funds-default" });
const rows = (page: Page) => page.locator("[data-funds-row]");
const rowOf = (page: Page, name: string) => rows(page).filter({ has: page.locator("[data-row-name]", { hasText: name }) });
const names = (page: Page) => rows(page).locator("[data-row-name]").allTextContents();
const panel = (page: Page) => page.getByRole("dialog");
const noSideways = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
const send = async (page: Page) => {
  await panel(page).getByRole("button", { name: "Send to Finance" }).click();
  await page.locator('[data-confirm-dialog="request-confirm"] [data-confirm-ok]').click();
  await expect(page.locator("[data-request-sent]")).toContainText(/sent to Finance for approval/);
};

test.beforeEach(async () => {
  await cleanFunds();
  await resetLoans();
});
test.afterAll(async () => {
  await cleanFunds();
  await resetLoans();
});

test("one list: no tabs; the statuses in Filters with All open by default; overdue first, then the soonest due", async ({ page }) => {
  await makeFunds();
  await signInWith(page, DP);
  await page.goto("/my-funds");
  const main = page.getByRole("main");
  await expect(main.getByRole("navigation", { name: "My funds tabs" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "My funds" })).toHaveCSS("font-size", "22px");
  await expect(main).toContainText("Your cash for jobs: request, receive, liquidate.");
  await page.locator("[data-info-tip=funds]").hover();
  await expect(page.locator("[data-info-tip-text=funds]")).toContainText("Needs funds");
  await page.mouse.move(0, 0);
  // All open: the two jobs that need funds, the requested, the released and the one to liquidate (not the liquidated).
  await expect.poll(() => names(page)).toEqual(expect.arrayContaining(["Fe Reyes", "Gil Cruz", "Hana Diaz", "Ivan Lopez", "Lea Tan"]));
  await expect(rows(page)).toHaveCount(5);
  expect((await names(page))[0]).toBe("Ivan Lopez"); // the soonest liquidation due first
  await expect(page.locator("[data-status-summary]")).toHaveText("Showing: all open");
  await shot(page, "my-funds-default");
  // The statuses are in Filters: All open is chosen, no status is ticked.
  await page.locator("[data-more-filters]").click();
  await expect(page.locator("[data-status-option=all]")).toHaveAttribute("aria-pressed", "true");
  for (const k of ["needs", "requested", "liquidate", "liquidated"]) await expect(page.locator(`[data-status-option=${k}]`)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-status-option=needs] [data-filter-n]")).toHaveText("2");
  await page.locator("[data-status-option=liquidated]").click();
  await expect(page).toHaveURL(/status=liquidated/);
  await expect.poll(() => names(page)).toEqual(["Kim Ramos"]);
  await expect(page.locator("[data-filter-count]")).toHaveText("1");
  await page.locator("[data-status-option=liquidated]").click();
  await expect(page).toHaveURL(/\/my-funds$/);
  await expect(rows(page)).toHaveCount(5);
  await noSideways(page);
});

test("one search and Filters that apply at once (Type, Transaction, Sort), in the address", async ({ page }) => {
  await makeFunds();
  await signInWith(page, DP);
  await page.goto("/my-funds");
  const box = page.getByRole("searchbox", { name: "Search my funds" });
  await expect(box).toHaveAttribute("placeholder", "Search PN or borrower");
  await box.fill("lea");
  await box.press("Enter");
  await expect.poll(() => names(page)).toEqual(["Lea Tan"]);
  await box.fill(FPN("2").slice(-5));
  await box.press("Enter");
  await expect.poll(() => names(page)).toEqual(["Gil Cruz"]);
  await box.fill("");
  await box.press("Enter");
  await expect(rows(page)).toHaveCount(5);
  await page.locator("[data-more-filters]").click();
  await page.locator("[data-type-option=FT]").click();
  await expect(page).toHaveURL(/type=FT/);
  await expect.poll(() => names(page)).toEqual(["Lea Tan"]);
  await page.locator("[data-type-option=any]").click();
  await page.locator("[data-filter=txn] select").selectOption("MORTGAGE");
  await expect(page).toHaveURL(/txn=MORTGAGE/);
  await expect.poll(() => names(page)).toEqual(["Gil Cruz"]);
  await page.locator("[data-filter=txn] select").selectOption("");
  await page.locator("[data-filter=sort] select").selectOption("borrower:asc");
  await expect(page).toHaveURL(/sort=borrower/);
  await expect.poll(async () => (await names(page))[0]).toBe("Fe Reyes");
});

test("rows like the Loans table: Borrower with the PN, Transaction, LTO office, Type, Requested, Released, Status, Liquidation due", async ({ page }) => {
  await makeFunds();
  await signInWith(page, DP);
  await page.goto("/my-funds");
  const ivan = rowOf(page, "Ivan Lopez");
  await expect(ivan.locator("[data-row-pn]")).toHaveText(FPN("4"));
  await expect(ivan.locator("[data-row-txn]")).toHaveText("Notary");
  await expect(ivan.locator("[data-row-lto]")).toContainText("LTO");
  await expect(ivan.locator("[data-row-type]")).toHaveText("CA");
  await expect(ivan.locator("[data-row-requested]")).toContainText("₱1,500.00");
  await expect(ivan.locator("[data-row-released]")).toContainText("₱1,500.00");
  await expect(ivan.locator("[data-funds-status]")).toHaveText("To liquidate");
  await expect(ivan.locator("[data-liq]")).toHaveText(/^(Due in \d+ days?|Due today)$/);
  await expect(rowOf(page, "Lea Tan").locator("[data-liq]")).toHaveText("Waiting for LTO pickup");
  await expect(rowOf(page, "Hana Diaz").locator("[data-funds-status]")).toHaveText("Requested");
  await expect(rowOf(page, "Fe Reyes").locator("[data-funds-status]")).toHaveText("Needs funds");
  // The processor's own amounts, not the loan amount (that stays behind "See loan amounts").
  expect(await (await page.request.get("/my-funds")).text()).not.toMatch(/350,000/);
  if (width(page) >= 1024) {
    await expect(page.locator("[data-funds-list] [aria-hidden=true]").first()).toHaveText(/Borrower\s*Transaction\s*LTO office\s*Type\s*Requested\s*Released\s*Status\s*Liquidation due/);
  }
  await expect(ivan.locator("a")).toHaveCount(0);
  const cut = await rows(page).locator("[data-row-name], [data-row-pn]").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(cut).toBe(0);
  await noSideways(page);
});

test("Request from one job: compact lines, Other's description only with an amount, over the maximum and not-a-number refused, totals, Send asks first", async ({ page }) => {
  const f = await makeFunds();
  await signInWith(page, DP);
  await page.goto("/my-funds");
  // The row's panel: Request (and Open job).
  await rowOf(page, "Fe Reyes").click();
  await expect(panel(page).locator("[data-funds-action=job]")).toBeVisible();
  await panel(page).locator("[data-funds-action=request]").click();
  const form = panel(page).locator("[data-request-form]");
  await expect(form.locator("[data-request-job]")).toHaveCount(1);
  const job = form.locator(`[data-request-job="${FPN("1")}"]`);
  await expect(job.locator("[data-request-job-head]")).toContainText(`Fe Reyes · ${FPN("1")} · Notary`);
  const fee = job.getByRole("textbox", { name: "Notary fee amount (PHP)" });
  const other = job.getByRole("textbox", { name: "Other amount (PHP)" });
  // The amount sits right beside the line's name (not at the far right of a wide line).
  const nameBox = (await job.locator("[data-request-line=NOTARY_FEE] label").first().boundingBox())!;
  expect(Math.abs((await fee.boundingBox())!.y - nameBox.y)).toBeLessThan(nameBox.height + 8);
  // Other: no description until it has an amount.
  await expect(job.locator("[data-other-description]")).toHaveCount(0);
  await other.fill("150");
  await expect(job.locator("[data-other-description]")).toBeVisible();
  const sendBtn = panel(page).getByRole("button", { name: "Send to Finance" });
  await expect(sendBtn).toBeDisabled();
  await expect(panel(page).locator("[data-send-why]")).toContainText("Say what this expense is");
  await job.getByLabel("What is this expense?").fill("Courier");
  // Not a number (a minus) and over the maximum are refused until fixed.
  await fee.fill("-5");
  await expect(job.locator("[data-line-error=amount]")).toBeVisible();
  await expect(sendBtn).toBeDisabled();
  await fee.fill("6000");
  await expect(job.locator("[data-line-error=over-max]")).toContainText("Above the maximum");
  await expect(sendBtn).toBeDisabled();
  await fee.fill("1500");
  await expect(job.locator("[data-line-error]")).toHaveCount(0);
  // Running totals: the job's and the grand total.
  await job.getByRole("textbox", { name: "Transport amount (PHP)" }).fill("300");
  await expect(job.locator("[data-job-total]")).toHaveText("₱1,950.00");
  await expect(panel(page).locator("[data-grand-total]")).toHaveText("Total ₱1,950.00");
  await expect(panel(page).locator("[data-request-footer]")).toBeInViewport();
  await shot(page, "my-funds-request");
  // Send asks first; Cancel leaves it; Send sends one request.
  await sendBtn.click();
  const ask = page.locator('[data-confirm-dialog="request-confirm"]');
  await expect(ask.getByRole("heading")).toHaveText("Send this request to Finance?");
  await expect(ask).toContainText("₱1,950.00");
  await ask.locator("[data-confirm-cancel]").click();
  await expect(ask).toBeHidden();
  await send(page);
  const adv = await db.cashAdvance.findFirstOrThrow({ where: { lines: { some: { transactionId: f.needA.id } } }, include: { lines: true } });
  expect(adv.requestedCents).toBe(195_000);
  expect(adv.lines.find((l) => l.kind === "OTHER")?.otherDescription).toBe("Courier");
  // One row per advance line now (the fee, transport and other), each Requested.
  await expect(rowOf(page, "Fe Reyes")).toHaveCount(3);
  for (const s of await rowOf(page, "Fe Reyes").locator("[data-funds-status]").allTextContents()) expect(s).toBe("Requested");
});

test("Request for several jobs at once: tick them, one request covering both", async ({ page }) => {
  const f = await makeFunds();
  await signInWith(page, DP);
  await page.goto("/my-funds");
  await page.locator(`[data-pick="${FPN("1")}"]`).check();
  await page.locator(`[data-pick="${FPN("2")}"]`).check();
  await expect(page.locator("[data-request-funds]")).toHaveText("Request funds (2)");
  await page.locator("[data-request-funds]").click();
  const form = panel(page).locator("[data-request-form]");
  await expect(form.locator("[data-request-job]")).toHaveCount(2);
  await form.locator(`[data-request-job="${FPN("2")}"]`).getByRole("textbox", { name: "Notary fee amount (PHP)" }).fill("700");
  await expect(panel(page).locator("[data-grand-total]")).toHaveText("Total ₱2,200.00"); // ₱1,500 suggested + ₱700
  await send(page);
  const adv = await db.cashAdvance.findFirstOrThrow({ where: { lines: { some: { transactionId: f.needB.id } } }, include: { lines: true } });
  expect(new Set(adv.lines.map((l) => l.transactionId))).toEqual(new Set([f.needA.id, f.needB.id]));
});

test("Request funds stays enabled with no job to fund: other expenses only, with a note at the top", async ({ page }) => {
  await signInWith(page, DP);
  await page.goto("/my-funds");
  await expect(page.locator("[data-request-funds]")).toBeEnabled();
  await page.locator("[data-request-funds]").click();
  await expect(panel(page).locator("[data-no-jobs-note]")).toHaveText("No jobs need funds right now. You can still request other expenses.");
  await expect(panel(page).locator("[data-request-job]")).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Add an expense" })).toBeVisible();
});

test("an overdue liquidation blocks a new request; Finance's one-time exception lets one through", async ({ page }) => {
  const f = await makeFunds({ overdue: true });
  await signInWith(page, DP);
  await page.goto("/my-funds");
  await expect(rowOf(page, "Jun Santos").locator("[data-liq]")).toHaveText(/^Overdue by \d+ days?$/);
  expect((await names(page))[0]).toBe("Jun Santos"); // overdue first
  await page.locator("[data-request-funds]").click();
  await expect(panel(page).locator("[data-request-blocked]")).toContainText(`${FNUM("CA", "07")} is overdue`);
  await expect(panel(page).getByRole("button", { name: "Send to Finance" })).toBeDisabled();
  await page.keyboard.press("Escape");
  const admin = await db.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  await db.fundsException.create({ data: { dpUserId: f.dpId, grantedById: admin.id, grantedAt: new Date(), note: "e2e: D-065" } });
  await page.reload();
  await expect(page.locator("[data-exception-note]")).toContainText("one more request");
  await page.locator("[data-request-funds]").click();
  await expect(panel(page).locator("[data-request-blocked]")).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Send to Finance" })).toBeEnabled();
});

test("the advance's panel: FT receipt confirmation with a mismatch; actions per status", async ({ page }) => {
  await makeFunds();
  await signInWith(page, DP);
  await page.goto("/my-funds");
  await rowOf(page, "Lea Tan").click();
  const ft = panel(page).locator(`[data-advance="${FNUM("FT", "06")}"]`);
  await expect(ft.locator('[data-funds-type="FT"]')).toBeVisible();
  await expect(ft.locator("[data-liquidate]")).toBeVisible(); // released: liquidate (receipts, change to return)
  const confirm = ft.locator(`[data-confirm-receipt="${FNUM("FT", "06")}"]`);
  await confirm.getByLabel("Reference number").fill("FT-889101");
  await confirm.getByLabel("Amount received (PHP)").fill("2400");
  await confirm.getByLabel("Last 4 digits of the account").fill("4821");
  await confirm.getByRole("button", { name: "Confirm receipt" }).click();
  await expect(panel(page)).toContainText(/It does not match: amount: typed ₱2,400.00, Finance recorded ₱2,500.00/);
  await page.keyboard.press("Escape");
  // Requested: nothing to confirm or liquidate yet.
  await rowOf(page, "Hana Diaz").click();
  await expect(panel(page).locator("[data-confirm-receipt], [data-liquidate]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Liquidated: nothing left to do.
  await page.goto("/my-funds?status=liquidated");
  await rowOf(page, "Kim Ramos").click();
  await expect(panel(page).locator("[data-liquidate]")).toHaveCount(0);
  await expect(panel(page).locator("[data-liquidation-line]")).toContainText("Liquidated");
});

test("liquidation in the panel: a receipt per line, spent vs released, the change to return", async ({ page }) => {
  const f = await makeFunds();
  await signInWith(page, DP);
  await page.goto("/my-funds");
  await rowOf(page, "Ivan Lopez").click();
  const a = panel(page).locator(`[data-advance="${FNUM("CA", "04")}"]`);
  const totals = a.locator("[data-liquidation-totals]");
  await expect(totals.locator("[data-panel-fact=t-released]")).toContainText("₱1,500.00");
  await expect(totals.locator("[data-panel-fact=t-spent]")).toContainText("₱900.00");
  await expect(totals.locator("[data-panel-fact=t-change]")).toContainText("₱600.00");
  await expect(a.locator("[data-liquidation-line]")).toContainText("Due ");
  await shot(page, "my-funds-panel");
  const line = a.locator("[data-receipt-line]").first();
  await line.getByLabel("Amount (PHP)").fill("400");
  await line.getByLabel("Receipt / OR no.").fill("OR-E2E-2");
  await line.getByRole("button", { name: "Add receipt" }).click();
  await expect(totals.locator("[data-panel-fact=t-spent]")).toContainText("₱1,300.00");
  await expect(totals.locator("[data-panel-fact=t-change]")).toContainText("₱200.00");
  const ret = a.locator("[data-return-change]");
  await expect(ret.getByLabel("Cash returned (PHP)")).toHaveValue("200.00");
  await ret.getByRole("button", { name: "Record return" }).click();
  await expect(totals.locator("[data-panel-fact=t-returned]")).toContainText("₱200.00");
  await expect(totals.locator("[data-panel-fact=t-change]")).toContainText("₱0.00");
  await expect(a.locator("[data-liquidate]")).toHaveCount(0); // nothing left to liquidate
  expect(await db.receipt.count({ where: { line: { advanceId: f.released.id } } })).toBe(2);
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

test("accessibility (WCAG 2.1 AA) with rows, the request panel and the advance's panel; 44 px to tap on a phone; no sideways scroll from 320 px", async ({ page }) => {
  await makeFunds();
  await signInWith(page, DP);
  await page.goto("/my-funds");
  await expect(rows(page).first()).toBeVisible();
  await axe(page, "/my-funds");
  if (width(page) < 768) {
    const small = await page.evaluate(() => [...document.querySelectorAll("[data-funds-row], [data-more-filters], [data-request-funds], [data-search-submit], [data-pick]")].map((e) => {
      const t = e.matches("[data-pick]") ? e.closest("label")! : e;
      const r = t.getBoundingClientRect();
      const b = getComputedStyle(t, "::before");
      const out = (v: string) => (b.content !== "none" && b.position === "absolute" && v.endsWith("px") ? Math.max(0, -parseFloat(v)) : 0);
      return { what: e.textContent?.trim().slice(0, 20), h: r.height + out(b.top) + out(b.bottom) };
    }).filter((x) => x.h < 44));
    expect(small).toEqual([]);
  }
  await page.locator("[data-request-funds]").click();
  await expect(panel(page).locator("[data-request-form]")).toBeVisible();
  await axe(page, "/my-funds request panel");
  await page.keyboard.press("Escape");
  await rowOf(page, "Ivan Lopez").click();
  await expect(panel(page).locator("[data-advance]")).toBeVisible();
  await axe(page, "/my-funds advance panel");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/my-funds");
  await expect(rows(page).first()).toBeVisible();
  await noSideways(page);
});
