import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn } from "./helpers";

/**
 * On hold, made clear: the reason category AND the remarks wherever a hold appears (Loan File banner,
 * Check documents, Open items, rows, the Resume form, the Journey), soft colours (no filled navy pills),
 * one status pill per held row, and light text that meets WCAG AA. Screenshots: docs/screenshots/on-hold/.
 */
const DIR = "docs/screenshots/on-hold";
mkdirSync(DIR, { recursive: true });
const PN = "GD1652026901003";
const REMARKS = "No Available DP";

test.beforeEach(async () => {
  await resetLoans();
});

const wide = (page: Page) => page.viewportSize()!.width >= 1100;
async function shot(page: Page, name: string, fullPage = true) {
  await page.screenshot({ path: `${DIR}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
async function openPn3(page: Page) {
  await page.goto(`/loans?fill=${PN}`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
  const open = main.getByRole("button", { name: "Open loan file" });
  // On a cold dev server the answers can be clicked before the page is ready: answer again until it unlocks.
  await expect(async () => {
    await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
    await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
    await expect(open).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await open.click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
}
const txnOf = (code: string) => db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code } } });

/**
 * Light-text contrast, measured in the browser: every visible pill, the hold summary's lines and the
 * row lines have at least 4.5:1 against the colour actually behind them (WCAG AA).
 */
async function contrastIssues(page: Page) {
  return page.evaluate(() => {
    const parse = (c: string): number[] | null => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c) ?? /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(c);
      if (!m) return null;
      const k = c.startsWith("color(") ? 255 : 1;
      return [Number(m[1]) * k, Number(m[2]) * k, Number(m[3]) * k, m[4] === undefined ? 1 : Number(m[4])];
    };
    const over = (f: number[], b: number[]) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
    const lum = (c: number[]) => {
      const [r, g, b] = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    /** The solid colour behind an element: its own and its parents' backgrounds, laid over white. */
    const behind = (el: Element): number[] => {
      const stack: number[][] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; }
      }
      return stack.reverse().reduce((acc, c) => over(c, acc), [255, 255, 255, 1]);
    };
    const sel = ".chip, [data-hold-summary] p, [data-hold-summary] h3, [data-hold-summary] blockquote, [data-status-line], [data-clock], [data-open-reason], [data-open-remarks], [data-clock-note]";
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll(sel))) {
      if (!(el as HTMLElement).offsetParent || !el.textContent?.trim()) continue;
      const bg = behind(el);
      const fg = over(parse(getComputedStyle(el).color)!, bg);
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      if (ratio < 4.5) out.push(`${ratio.toFixed(2)} "${el.textContent.trim().slice(0, 40)}"`);
    }
    return out;
  });
}
/** No status pill is a filled navy block. */
async function filledNavyPills(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll(".chip")).filter((el) => (el as HTMLElement).offsetParent && getComputedStyle(el).backgroundColor === "rgb(12, 35, 64)").map((el) => el.textContent?.trim()));
}

test("On hold shows the reason and the remarks everywhere, with soft colours", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "la");
  await openPn3(page);

  // Mortgage: tick every paper (Ready to send), then put it on hold from Check documents.
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  const papers = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await papers.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await expect.poll(async () => (await txnOf("MORTGAGE")).status).toBe("READY");

  // The form: reason category required, remarks ALWAYS required (5+ characters, with a counter), no expected resume date.
  await page.getByRole("button", { name: "Put on hold" }).click();
  const form = page.getByRole("dialog", { name: "Put on hold" });
  const save = form.getByRole("button", { name: "Put on hold" });
  await expect(form.getByLabel("Reason category (required)")).toBeVisible();
  await expect(form.getByLabel("Remarks (required)")).toBeVisible();
  await expect(form.locator('input[type="date"], input[type="datetime-local"]')).toHaveCount(0); // no expected resume date
  await expect(form).toContainText("No expected resume date. The date and time are recorded by the system (PHT).");
  await expect(form.locator("[data-now-line]")).toHaveText(/^Starts now: .+ PHT$/);
  await form.getByLabel("Reason category (required)").selectOption({ label: "Other" });
  await expect(save).toBeDisabled(); // a reason alone is not enough
  await form.getByLabel("Remarks (required)").fill("No D");
  await expect(form.locator("[data-remarks-help]")).toHaveText("At least 5 characters, up to 500.");
  await expect(form.locator("[data-count]")).toHaveText("4 / 500");
  await expect(save).toBeDisabled();
  await form.getByLabel("Remarks (required)").fill(REMARKS);
  await expect(save).toBeEnabled();
  await shot(page, "put-on-hold-form", false);
  await save.click();
  await expect(form).toBeHidden();
  const stored = await db.hold.findFirstOrThrow({ where: { transaction: { loan: { pn: PN }, type: { code: "MORTGAGE" } }, resumedAt: null } });
  expect(stored.note).toBe(REMARKS);

  // Check documents, held Mortgage: the summary at the top of the left side; no second On hold pill in the header.
  await page.reload();
  const summary = page.locator("[data-hold-summary]");
  await expect(summary).toHaveCount(1);
  await expect(summary.locator("[data-hold-title]")).toHaveText("On hold: Other");
  await expect(summary.locator("blockquote[data-remarks]")).toHaveText(REMARKS);
  await expect(summary.locator("[data-hold-by]")).toHaveText(/^Put on hold by Test Loan Associate · [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s?[AP]M PHT · (just now|\d+ minutes? ago)$/);
  await expect(summary.locator("[data-to-continue]")).toHaveText("To continue: press Resume and write what changed");
  await expect(page.locator('[data-title-chip="hold"]')).toHaveCount(0);
  // Locked: the papers stay readable, their controls are disabled, and the page says why.
  await expect(page.locator("[data-lock-note]").filter({ visible: true })).toContainText("Locked: on hold by Test Loan Associate since");
  await expect(page.getByRole("group", { name: /papers$/ }).first().getByRole("checkbox").first()).toBeDisabled();
  // The transactions list: one pill (On hold) and the day count as plain text; the reason is in the card, not repeated here.
  const list = wide(page) ? page.getByRole("region", { name: /^Transactions \(\d+\)$/ }) : page.getByRole("region", { name: "Transactions", exact: true });
  const row = list.locator("[data-txn=MORTGAGE]");
  await expect(row.locator("[data-status-chip]")).toHaveCount(1);
  await expect(row.locator("[data-status-chip]")).toHaveText("On hold");
  await expect(row.locator("[data-status-line]")).toHaveCount(0);
  await expect(row).not.toContainText("Ready to send");
  await expect(row).not.toContainText("Processing ·");
  await expect(list).not.toContainText(/required papers$/m);
  // The hold is the step to do now in the "Do this now" card; Open items does not repeat it (nothing else is open: no card).
  await expect(page.locator('[data-do-now] [data-step="hold"]')).toHaveAttribute("data-step-state", "now");
  await expect(page.locator("[data-do-now]")).toHaveAttribute("data-tone", "hold");
  await expect(page.getByText(REMARKS).filter({ visible: true })).toHaveCount(1);
  await expect(page.locator("[data-open-items]").filter({ visible: true })).toHaveCount(0);
  expect(await filledNavyPills(page)).toEqual([]);
  expect(await contrastIssues(page)).toEqual([]);
  await shot(page, "check-documents-held-mortgage");
  await noSideways(page);

  // Loan File, To do: the calm On hold banner above the Next step card, with Resume; the clock note once.
  await page.goto(`/loans/${PN}?tab=todo`);
  const banner = page.locator("[data-holds-banner]");
  await expect(banner.locator("[data-hold-summary]")).toHaveCount(1);
  await expect(banner.locator("[data-hold-txn]")).toHaveText("Mortgage");
  await expect(banner.locator("[data-hold-title]")).toHaveText("On hold: Other");
  await expect(banner.locator("blockquote[data-remarks]")).toHaveText(REMARKS);
  await expect(banner.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(page.getByText("The TAT clock keeps running")).toHaveCount(1);
  const order = await page.evaluate(() => {
    const b = document.querySelector("[data-holds-banner]")!;
    const n = document.querySelector("[data-next-step]")!;
    return b.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order, "the banner sits above the Next step card").toBeTruthy();
  await expect(page.locator("[data-next-step]")).toHaveAttribute("data-next-step", "go"); // other transactions still need work
  const todoRow = page.locator("[data-txn-row=MORTGAGE]");
  await expect(todoRow.locator("[data-status-chip]")).toHaveCount(1);
  await expect(todoRow.locator("[data-status-chip]")).toHaveText("On hold");
  await expect(todoRow.locator("[data-status-line]")).toHaveText("On hold: Other · 1 day");
  await expect(todoRow.locator("[data-clock]")).toHaveText(/^Day \d+ of \d+$/);
  expect(await filledNavyPills(page)).toEqual([]);
  expect(await contrastIssues(page)).toEqual([]);
  await shot(page, "loan-file-todo-held-mortgage");
  await noSideways(page);

  // Every open transaction on hold: the Next step card waits for a resume; its usual button becomes secondary.
  const reasonId = stored.reasonId;
  for (const code of ["NOTARY", "EDST", "PPSR"]) {
    const t = await txnOf(code);
    await db.hold.create({ data: { loanId: t.loanId, transactionId: t.id, reasonId, note: `Waiting for the borrower (${code})`, raisedByLabel: "Test Loan Associate" } });
  }
  await page.reload();
  await expect(page.locator("[data-next-step]")).toHaveAttribute("data-next-step", "waiting");
  await expect(page.locator("#next")).toHaveText("Waiting for a resume");
  await expect(page.locator("[data-next-step] .btn-gold")).toHaveCount(0);
  await expect(page.locator("[data-holds-banner] [data-hold-summary]")).toHaveCount(4);
  await expect(page.getByText("The TAT clock keeps running")).toHaveCount(1);
  await shot(page, "loan-file-all-on-hold");
  for (const code of ["NOTARY", "EDST", "PPSR"]) await db.hold.deleteMany({ where: { transaction: { loan: { pn: PN }, type: { code } } } });

  // Resume form: the original reason, the remarks and how long it has been on hold, then the required remarks.
  await page.goto(`/loans/${PN}?tab=todo`);
  await page.locator("[data-holds-banner]").getByRole("button", { name: "Resume" }).click();
  const resume = page.getByRole("dialog", { name: "Resume the work" });
  await expect(resume.locator("[data-closing]")).toContainText("On hold: Other");
  await expect(resume.locator("[data-closing] [data-remarks]")).toHaveText(REMARKS);
  await expect(resume.locator("[data-on-hold-for]")).toHaveText(/^Put on hold by Test Loan Associate · on hold for (less than a minute|\d+ minutes?)$/);
  const go = resume.getByRole("button", { name: "Resume", exact: true });
  await expect(go).toBeDisabled();
  await resume.getByLabel("Resume remarks (required)").fill("A DP is free now");
  await expect(go).toBeEnabled();
  await shot(page, "resume-form", false);
  await go.click();
  await expect(page.locator("[data-holds-banner]")).toHaveCount(0);

  // Journey: two entries for the hold.
  await page.goto(`/loans/${PN}?tab=journey`);
  const sub = page.locator('[data-sub="hold"]').filter({ visible: true }).first();
  await expect(sub.locator("[data-hold-started]")).toHaveText(new RegExp(`^Put on hold · Other · ${REMARKS} · by Test Loan Associate · .+ PHT$`));
  await expect(sub.locator("[data-hold-resumed]")).toHaveText(/^Resumed · A DP is free now · by Test Loan Associate · .+ PHT · was on hold for .+$/);
});

test("An older hold without remarks: the fallback and Add details", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "la");
  await openPn3(page);
  const t = await txnOf("PPSR");
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } }).catch(() => db.user.findFirstOrThrow({ where: { name: "Test Loan Associate" } }));
  const reason = await db.holdReason.findUniqueOrThrow({ where: { code: "OTHER" } });
  await db.hold.create({ data: { loanId: t.loanId, transactionId: t.id, reasonId: reason.id, note: "", raisedById: la.id, raisedByLabel: la.name, ownerId: la.id, ownerLabel: la.name, raisedAt: new Date(Date.now() - 26 * 3_600_000) } });
  // No invalid nesting: "Add details" renders a <dialog> with a form, which must not sit inside a <p>.
  const nesting: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && /cannot be a descendant of|cannot contain a nested|hydration/i.test(m.text())) nesting.push(m.text()); });
  // Check documents: the same fallback inside the "Do this now" card.
  await page.goto(`/loans/${PN}?tab=todo&tx=PPSR`);
  await expect(page.locator("[data-do-now] [data-remarks=none]").filter({ visible: true }).first()).toContainText("No details were written.");
  await page.goto(`/loans/${PN}?tab=todo`);
  const s = page.locator("[data-holds-banner] [data-hold-summary]");
  await expect(s.locator("[data-remarks=none]")).toContainText("No details were written.");
  expect(nesting, nesting.join("\n")).toEqual([]);
  await expect(s.locator("[data-hold-by]")).toContainText("· 1 day ago");
  await s.getByRole("button", { name: "Add details" }).click();
  const dlg = page.getByRole("dialog", { name: "Add the hold details" });
  await dlg.getByLabel("Remarks (required)").fill("Waiting for the original OR/CR");
  await dlg.getByRole("button", { name: "Save the details" }).click();
  await expect(s.locator("blockquote[data-remarks]")).toHaveText("Waiting for the original OR/CR");
  await expect(s.getByRole("button", { name: "Add details" })).toHaveCount(0);
});
