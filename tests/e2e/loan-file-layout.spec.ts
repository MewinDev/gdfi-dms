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
/** The side panel (from 1280px); below that the card's block sits above the strip in its own box. */
const wideCard = (page: Page) => page.viewportSize()!.width >= 1280;
/** The stepper shows only the current step under 1024px (the longer names do not fit a tenth of the width). */
const compactStepper = (page: Page) => page.viewportSize()!.width < 1024;

test("D-062 summary card: the name with the due badge and refresh; the PN; six details; no step heading above the stepper", async ({ page }) => {
  await openLoan(page);
  const main = page.getByRole("main");
  const header = main.locator("[data-loan-header]");
  const card = header.locator("[data-card-identity]");
  // The borrower's name is the page's h1, in its own card; the PN in monospace with Copy; the due badge.
  const name = card.getByRole("heading", { level: 1, name: "Maria Santos" });
  await expect(name).toBeVisible();
  await expect(main.getByRole("heading", { level: 1, name: "Loan File" })).toHaveCount(0);
  await expect(card.locator("[data-pn]")).toHaveText("GD1012026901001");
  expect(await card.locator("[data-pn]").evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/mono/i);
  await expect(card.getByRole("button", { name: "Copy PN" })).toBeVisible();
  await expect(card.locator("[data-due-chip]")).toHaveText(/day(s)? left|Due today|Late by \d+ days?/);
  // On the name's line at the right: the status in myloans, the due badge, then the refresh icon; the PN under the
  // name; no branch badge.
  await expect(card.locator("[data-myloans-status]")).toHaveText(/Loan Released/);
  expect((await card.locator("[data-myloans-status]").boundingBox())!.x).toBeLessThan((await card.locator("[data-due-chip]").boundingBox())!.x);
  await expect(card.locator("[data-branch-badge]")).toHaveCount(0);
  const nameBox = (await name.boundingBox())!;
  const dueBox = (await card.locator("[data-due-chip]").boundingBox())!;
  const refreshBox = (await card.getByRole("button", { name: "Refresh from myloans" }).boundingBox())!;
  expect(Math.abs((dueBox.y + dueBox.height / 2) - (nameBox.y + nameBox.height / 2))).toBeLessThan(8);
  expect(refreshBox.x).toBeGreaterThan(dueBox.x);
  const cardBox = (await card.boundingBox())!;
  expect(cardBox.x + cardBox.width - (refreshBox.x + refreshBox.width)).toBeLessThan(24); // at the card's right
  expect((await card.locator("[data-pn]").boundingBox())!.y).toBeGreaterThan(nameBox.y + nameBox.height - 2); // under the name
  // Six details: two columns on a phone, three on a tablet, one row of six on a wide screen.
  await expect(card.locator("[data-fact]")).toHaveCount(6);
  await expect(card.locator('[data-fact="loan-type"]')).toHaveText(/^Loan type\s*New$/);
  await expect(card.locator('[data-fact="amount"]')).toHaveText(/Amount\s*₱450,000/);
  await expect(card.locator('[data-fact="released"]')).toHaveText(/Released on\s*[A-Z][a-z]{2} \d{1,2}, \d{4}/);
  await expect(card.locator('[data-fact="branch"]')).toHaveText(/Branch\s*Antipolo/);
  await expect(card.locator('[data-fact="branch"]')).toHaveAttribute("title", "Opened at Antipolo");
  await expect(card.locator('[data-fact="assigned"]')).toHaveText(/Assigned to\s*Test Loan Associate/);
  const cols = await card.locator("dl").evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(" ").length);
  const w = page.viewportSize()!.width;
  expect(cols).toBe(w >= 1024 ? 6 : w >= 640 ? 3 : 2);
  // The old subtitle, the "MyLoans · Last checked" text and the big Refresh button are gone.
  await expect(main.getByText("Maria Santos · GD1012026901001")).toHaveCount(0);
  await expect(main.getByText(/MyLoans · Last checked/)).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Refresh from MyLoans", exact: true })).toHaveCount(0);
  // The tabs stay pinned under the top bar while the page scrolls (one tap to another tab).
  // (When the page is too short to scroll the tabs up to the top bar, they stop where the scroll ends.)
  const tabsNav = main.getByRole("navigation", { name: "Loan file sections" });
  const natural = (await tabsNav.boundingBox())!.y;
  const scrolled = await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); return window.scrollY; });
  await expect(tabsNav).toBeInViewport();
  const top = (await tabsNav.boundingBox())!.y;
  expect(top).toBeLessThanOrEqual(Math.max(phone(page) ? 56 : w >= 768 ? 72 : 56, natural - scrolled) + 2);
  await tabsNav.getByRole("link", { name: "Documents" }).click();
  await expect(page).toHaveURL(/tab=documents/);
  await page.goto("/loans/GD1012026901001");
  // No "Check documents" heading above the stepper (the stepper says the step).
  await expect(header.locator("[data-step-title]")).toHaveCount(0);
  if (phone(page)) {
    await expect(main.getByRole("link", { name: /^‹?\s*Loans$/ }).first()).toBeVisible();
  } else {
    const crumbs = main.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(crumbs.getByRole("link", { name: "Loans", exact: true })).toBeVisible();
    await expect(crumbs.getByText("GD1012026901001")).toHaveAttribute("aria-current", "page");
  }
  await noSideScroll(page);

  // Check documents, Documents and Journey: the same header; the step heading under it, the tabs right below.
  for (const [q, step] of [["?tab=todo&tx=NOTARY", "Check documents"], ["?tab=documents", "Check documents"], ["?tab=journey", "Check documents"]] as const) {
    await page.goto(`/loans/GD1012026901001${q}`);
    if (q.includes("tx=")) await expect(header.locator("[data-step-title]")).toHaveText(step);
    else await expect(header.locator("[data-step-title]")).toHaveCount(0);
    if (q.includes("tx=")) {
      // Check documents (the user's review): the step is the page's heading; the name, the refresh icon at the right of
      // its line, the due badge beside it, the PN under the name, then six details (with Branch and Assigned to) are at
      // the top of the transactions card. No "Loan details" heading, no divider, no branch badge.
      await expect(header.getByRole("heading", { level: 1, name: "Check documents" })).toBeVisible();
      await expect(header.locator("[data-borrower], [data-fact], [data-branch-badge]")).toHaveCount(0);
      const card = main.locator("[data-card-identity]").filter({ visible: true });
      await expect(card.getByRole("heading", { name: "Maria Santos" })).toBeVisible();
      await expect(card.locator("[data-pn]")).toHaveText("GD1012026901001");
      await expect(card.getByRole("button", { name: "Copy PN" })).toBeVisible();
      await expect(card.locator("[data-branch-badge]")).toHaveCount(0); // no branch badge in the card
      const nameBox = (await card.locator("[data-borrower]").boundingBox())!;
      const refreshBox = (await card.getByRole("button", { name: "Refresh from myloans" }).boundingBox())!;
      const dueBox = (await card.locator("[data-due-chip]").boundingBox())!;
      expect(dueBox.x + dueBox.width).toBeLessThanOrEqual(refreshBox.x + 1); // the due badge beside the refresh icon
      expect(Math.abs((dueBox.y + dueBox.height / 2) - (refreshBox.y + refreshBox.height / 2))).toBeLessThan(4);
      const cardBox = (await card.boundingBox())!;
      expect(refreshBox.y).toBeLessThan(nameBox.y + nameBox.height); // on the name's line
      expect(cardBox.x + cardBox.width - (refreshBox.x + refreshBox.width)).toBeLessThan(20); // at its right
      expect((await card.locator("[data-pn]").boundingBox())!.y).toBeGreaterThan(nameBox.y); // the PN under the name
      await expect(main.getByText("Loan details")).toHaveCount(0);
      // Six details: product, loan type, amount, released on, branch, assigned to. Two columns on a phone and in the
      // desktop side panel, three on a tablet.
      await expect(card.locator("[data-fact]")).toHaveCount(6);
      const cols = await card.locator("dl").evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(" ").length);
      const w = page.viewportSize()!.width;
      expect(cols).toBe(w >= 640 && w < 1280 ? 3 : 2);
      await expect(card.locator('[data-fact="amount"]')).toContainText("₱450,000");
      await expect(card.locator('[data-fact="branch"]')).toHaveText(/Branch\s*Antipolo/);
      await expect(card.locator('[data-fact="branch"]')).toHaveAttribute("title", "Opened at Antipolo");
      await expect(card.locator('[data-fact="assigned"]')).toHaveText(/Assigned to\s*Test Loan Associate/);
      expect((await card.locator('[data-fact="product"]').boundingBox())!.y).toBeGreaterThan((await card.locator("[data-pn]").boundingBox())!.y); // under the PN
      const papersBox = (await main.locator("[data-package-summary]").filter({ visible: true }).boundingBox())!;
      expect(cardBox.y).toBeLessThan(papersBox.y); // above "0 of N required papers"
      // Its own card: the transactions card (required papers, transactions) is a separate card under it.
      if (wideCard(page)) expect(await card.evaluate((e) => !e.parentElement?.closest("section[aria-labelledby=all-txns]"))).toBe(true);
    } else {
      await expect(header.getByRole("heading", { level: 1, name: "Maria Santos" })).toBeVisible();
      await expect(header.locator("[data-card-identity] [data-fact]")).toHaveCount(6);
    }
    if (q.includes("tx=") && !phone(page)) await expect(main.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Home›Loans›GD1012026901001›Check documents");
    const tabs = main.getByRole("navigation", { name: "Loan file sections" });
    if (await tabs.isVisible() && q !== "?tab=journey" && q !== "?tab=documents") {
      const gap = (await tabs.boundingBox())!.y - ((await header.boundingBox())!.y + (await header.boundingBox())!.height);
      expect(gap).toBeLessThanOrEqual(12);
    }
    await noSideScroll(page);
  }
});

test("D-062 Refresh from myloans: an icon button with a tooltip (last checked), works with the keyboard", async ({ page }) => {
  await openLoan(page);
  const header = page.getByRole("main").locator("[data-loan-header]");
  const refresh = header.getByRole("button", { name: "Refresh from myloans" });
  await expect(refresh).toBeVisible();
  const box = (await refresh.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(30); // icon only
  await expect(refresh).toHaveAccessibleDescription(/^Refresh from myloans · last checked [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}/);
  // Keyboard: Tab reaches it, the tooltip shows on focus, Enter refreshes.
  await refresh.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(refresh).toBeFocused();
  await expect(header.locator("[data-refresh-tooltip]")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(header.locator("[data-refresh-result]")).toHaveText(/No changes|Changes found|small details|updated/);
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

test("Check documents: paper rows about 36px (44px to tap on a phone), the row menu; collapsed rows compact; side card and report row", async ({ page }) => {
  await openLoan(page);
  const main = page.getByRole("main");
  // D-062 review: "Something wrong?" is one row; the whole row opens Report a problem.
  await expect(main.getByRole("button", { name: "Something wrong? Report a problem" })).toBeVisible();
  await expect(main.locator("[data-report-row]")).toContainText("Something wrong?");
  await expect(main.getByText("Send by")).toBeVisible();
  await page.getByRole("link", { name: "Start checking" }).click();
  const notary = page.getByRole("region", { name: "Notary", exact: true });
  const rows = notary.locator("label[id^=line-]");
  await expect(rows).toHaveCount(7);
  // D-062: a paper row's line is about 36px at every width; on a phone the tick, the menu and Include keep 44px to tap
  // through an invisible margin (the box plus its ::before).
  const lines = notary.locator("[data-paper-row] > div:first-child");
  const heights = await lines.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  for (const h of heights) expect(h).toBeLessThanOrEqual(phone(page) ? 64 : 40); // a phone may wrap the chips under the name
  if (phone(page)) {
    const taps = await notary.locator("label[id^=line-], [data-row-menu]").evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      const b = getComputedStyle(e, "::before");
      const out = (v: string) => (b.content !== "none" && b.position === "absolute" && v.endsWith("px") ? Math.max(0, -parseFloat(v)) : 0);
      return Math.round(r.height + out(b.top) + out(b.bottom));
    }));
    for (const h of taps) expect(h).toBeGreaterThanOrEqual(44);
  }
  // The chips sit right after the name (not at the far right): 12px text.
  const first = notary.locator("[data-paper-row]").first();
  const nameBox = (await first.locator("[data-paper-name]").boundingBox())!;
  const tagBox = (await first.locator("[data-req-tag]").boundingBox())!;
  if (!phone(page)) expect(tagBox.x - (nameBox.x + nameBox.width)).toBeLessThanOrEqual(16);
  expect(await first.locator("[data-req-tag]").evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBe(12);
  // D-062 review: no "Mark missing" button repeated on every row; one quiet "⋯" menu per row holds it. It opens with the
  // keyboard, focuses "Mark as missing", and Esc closes it and gives the focus back.
  await expect(notary.getByRole("button", { name: /Mark .* missing/ })).toHaveCount(0);
  const menuButton = first.getByRole("button", { name: "More actions" });
  await expect(menuButton).toHaveAttribute("aria-haspopup", "menu");
  await menuButton.focus();
  await page.keyboard.press("Enter");
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await expect(first.getByRole("menuitem", { name: "Mark as missing" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(first.getByRole("menu")).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  // D-062: one progress per transaction (its header: text and a thin bar), no "Do this now" card, no "Go to the papers";
  // the side panel (or the strip) keeps only the overall count of required papers.
  await expect(main.locator("[data-txn-progress]")).toHaveCount(1);
  await expect(notary.locator("[data-paper-count]")).toHaveText(/^0 of \d+ required · 0 of \d+ optional$/);
  await expect(notary.getByRole("progressbar")).toHaveCount(1);
  await expect(main.locator("[data-do-now]")).toHaveCount(0);
  await expect(main.locator("[data-tick-progress]")).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Go to the papers" })).toHaveCount(0);
  await expect(notary.locator("[data-txn-hint]")).toHaveText(/^Tick the \d+ required papers, then send to DP$/);
  await expect(main.locator("[data-package-summary]").filter({ visible: true })).toHaveCount(1);
  await expect(main.locator("[data-package-summary]").filter({ visible: true })).toHaveText(/^0 of \d+ required papers$/);
  // Transactions: every one in number order, a side list at 1280 and up (D-062), a strip of cards below that.
  const wide = page.viewportSize()!.width >= 1280;
  const list = wide ? main.getByRole("region", { name: "Transactions (4)" }) : main.getByRole("region", { name: "Transactions", exact: true });
  const otherRows = list.getByRole("button");
  await expect(otherRows).toHaveCount(4);
  const otherHeights = await otherRows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  // Side-list rows stay compact; strip cards also carry the TAT chip (two chip lines at most).
  for (const h of otherHeights) { expect(h).toBeGreaterThanOrEqual(44); expect(h).toBeLessThanOrEqual(wide ? 90 : 130); }
  await noSideScroll(page);
});

test("D-062 bottom sheets on a phone: a grab handle instead of the X; drag down to close, a short drag springs back, the page behind stays still", async ({ page }) => {
  await openLoan(page);
  await page.goto("/loans/GD1012026901001?tab=todo&tx=NOTARY");
  await page.getByRole("button", { name: /Put on hold/ }).click();
  const sheet = page.getByRole("dialog", { name: "Put on hold" });
  await expect(sheet).toBeVisible();
  const handle = sheet.locator("[data-sheet-handle]");
  if (!phone(page)) {
    // Tablet and desktop: the centred dialog with its X; no handle.
    await expect(handle).toBeHidden();
    await expect(sheet.getByRole("button", { name: "Close" })).toBeVisible();
    return;
  }
  await expect(handle).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Close" })).toHaveCount(1); // the handle only (the X is hidden)
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  // A short drag springs back.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 40, { steps: 8 });
  await page.mouse.up();
  await expect(sheet).toBeVisible();
  // Only the sheet moves: the page behind is locked while it is open and does not scroll during the drag.
  const html = () => page.evaluate(() => ({ overflow: getComputedStyle(document.documentElement).overflow, y: window.scrollY }));
  const before = await html();
  expect(before.overflow).toBe("hidden");
  // A long drag closes it (nothing typed: no "Discard your changes?"). First let the spring-back finish (180 ms) and
  // find the handle again.
  await expect.poll(() => sheet.evaluate((d) => getComputedStyle(d).transform)).toBe("none");
  const b2 = (await handle.boundingBox())!;
  const [x2, y2] = [b2.x + b2.width / 2, b2.y + b2.height / 2];
  await page.mouse.move(x2, y2);
  await page.mouse.down();
  await page.mouse.move(x2, y2 + 160, { steps: 12 });
  expect((await html()).y).toBe(before.y);
  await page.mouse.up();
  await expect(sheet).toBeHidden();
  expect((await html()).overflow).not.toBe("hidden"); // released

  // Every bottom sheet works the same (here a plain one: Report a problem).
  await page.goto("/loans/GD1012026901001?tab=todo");
  await page.getByRole("button", { name: "Report a problem" }).click();
  const report = page.getByRole("dialog", { name: "Report a problem" });
  await expect(report.locator("[data-sheet-handle]")).toBeVisible();
  await expect(report.getByRole("button", { name: "Close" })).toHaveCount(1);
  const hb = (await report.locator("[data-sheet-handle]").boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 200, { steps: 12 });
  await page.mouse.up();
  await expect(report).toBeHidden();
});
