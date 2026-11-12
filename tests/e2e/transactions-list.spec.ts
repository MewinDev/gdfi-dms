import { expect, test, type Page } from "@playwright/test";
import { cleanSettingsTestRows, db, resetLoans } from "./db";
import { pickLtoOffice, signIn } from "./helpers";

/**
 * Every transaction, in order, on the Loan File (All transactions) and Check documents (Transactions,
 * strip on tablet and phone), with one status wording in both places. Screenshots go to SHOTS_DIR.
 */
test.beforeEach(async () => {
  await resetLoans();
  await cleanSettingsTestRows();
});
test.afterAll(async () => {
  await cleanSettingsTestRows();
});

const ORDER = ["NOTARY", "EDST", "PPSR", "MORTGAGE"];
const wide = (page: Page) => page.viewportSize()!.width >= 1100;
async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
async function openPn3(page: Page) {
  await page.goto("/loans?fill=GD1652026901003");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
  await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/GD1652026901003/);
}
const txnOf = (code: string) => db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: "GD1652026901003" }, type: { code } }, include: { checks: true } });
/** The Check documents list at this width (side list at 1100+, strip below). */
const checkList = (page: Page) => (wide(page) ? page.getByRole("region", { name: /^Transactions \(\d+\)$/ }) : page.getByRole("region", { name: "Transactions", exact: true }));
/** The one status pill, the short line and the day count (plain text) of one row (null when the row has none). */
async function texts(_page: Page, row: ReturnType<Page["locator"]>) {
  await expect(row.locator("[data-status-chip]").first()).toBeAttached();
  // Exactly one status pill per row.
  await expect(row.locator("[data-status-chip]")).toHaveCount(1);
  const one = async (sel: string) => ((await row.locator(sel).count()) ? ((await row.locator(sel).first().textContent()) ?? "").trim() : null);
  return {
    line: await one("[data-status-line]"),
    chip: await one("[data-status-chip]"),
    clock: await one("[data-clock]"),
  };
}

/** For each transaction: the Loan File row and the Check documents row say the same thing. */
async function sameWording(page: Page, selected = "NOTARY") {
  await page.goto("/loans/GD1652026901003?tab=todo");
  const todo: Record<string, Awaited<ReturnType<typeof texts>>> = {};
  for (const c of ORDER) todo[c] = await texts(page, page.locator(`[data-txn-row=${c}]`));
  await page.goto(`/loans/GD1652026901003?tab=todo&tx=${selected}`);
  for (const c of ORDER) {
    const check = await texts(page, checkList(page).locator(`[data-txn=${c}]`));
    expect.soft(check.chip, `${c} pill`).toBe(todo[c].chip);
    expect.soft(check.clock, `${c} day count`).toBe(todo[c].clock);
    // Check documents shows the word and the day count only: what to do is in the "Do this now" card.
    expect.soft(check.line, `${c} line`).toBeNull();
  }
  return todo;
}

test("4 transactions: every one, in order, in both places; one wording for each state", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "la");
  await openPn3(page);

  // Loan File: "All transactions (4)", in order, the Next step one tagged once.
  await page.goto("/loans/GD1652026901003?tab=todo");
  const all = page.locator("[data-all-txns]");
  await expect(all.getByRole("heading")).toHaveText("All transactions (4)");
  expect(await all.locator("[data-txn-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-txn-row")))).toEqual(ORDER);
  await expect(all.locator("[data-next-tag]")).toHaveCount(1);
  await expect(all.locator("[data-next] [data-status-line]")).toHaveCount(0); // its text is in the Next step card

  // States: Notary sent, EDST being checked, PPSR ready, Mortgage not started.
  const notary = await txnOf("NOTARY");
  await page.goto("/loans/GD1652026901003?tab=todo&tx=NOTARY");
  const group = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await group.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await expect(page.locator('[id^="send-why-"]')).toHaveText(/funds question/);
  const showAll = page.getByRole("button", { name: /^Show all/ });
  if (await showAll.count()) await showAll.click();
  await page.locator("label", { hasText: "Test Document Processor" }).click();
  await page.getByText("No funds needed", { exact: true }).click();
  await pickLtoOffice(page);
  await page.getByRole("button", { name: /^Send to (?!processor)/ }).click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(async () => (await txnOf("NOTARY")).status).toBe("ASSIGNED");
  await page.goto("/loans/GD1652026901003?tab=todo&tx=EDST");
  await page.getByRole("group", { name: /papers$/ }).first().getByRole("checkbox").first().check();
  await page.goto("/loans/GD1652026901003?tab=todo&tx=PPSR");
  for (const box of await page.getByRole("group", { name: /papers$/ }).first().getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await expect.poll(async () => (await txnOf("PPSR")).status).toBe("READY");

  let todo = await sameWording(page);
  // Sent: one short line in the list; who it went to and the LTO office are in the detail only.
  expect(todo.NOTARY.chip).toBe("Sent to DP");
  expect(todo.NOTARY.line).toBe("Waiting for the DP to accept");
  await page.goto("/loans/GD1652026901003?tab=todo&tx=NOTARY");
  await expect(page.locator(`section[id^="job-"]`)).toContainText("Sent to Test Document Processor");
  await expect(page.locator("[data-lto-chip]").filter({ visible: true })).toHaveCount(1);
  expect(todo.MORTGAGE.line ?? "Not started").toBe("Not started");
  expect(todo.PPSR).toMatchObject({ chip: "Ready to send" });

  // Processing, Problem, On hold, Missing paper, Done.
  await db.dpAssignment.updateMany({ where: { transactionId: notary.id }, data: { status: "ACCEPTED", decidedAt: new Date() } });
  await db.loanTransaction.update({ where: { id: notary.id }, data: { status: "IN_PROCESS", statusSince: new Date() } });
  const ppsr = await txnOf("PPSR");
  const mortgage = await txnOf("MORTGAGE");
  const edst = await txnOf("EDST");
  await db.problem.create({ data: { loanId: ppsr.loanId, transactionId: ppsr.id, reasonId: (await db.problemReason.findFirstOrThrow({ where: { active: true } })).id, raisedByLabel: "E2E" } });
  await db.hold.create({ data: { loanId: mortgage.loanId, transactionId: mortgage.id, reasonId: (await db.holdReason.findUniqueOrThrow({ where: { code: "CLIENT-PAPERS" } })).id, raisedByLabel: "E2E" } });
  const unticked = edst.checks.find((c) => !c.checked)!;
  await db.loanException.create({ data: { loanId: edst.loanId, transactionId: edst.id, type: "LEGAL_DOCS_COMPLETION", reason: "Missing", raisedByLabel: "E2E", details: { checkIds: [unticked.id], missing: ["x"] } } });
  todo = await sameWording(page, "MORTGAGE");
  expect(todo.NOTARY.chip).toBe("In progress");
  expect(todo.NOTARY.line).toBe("The DP is working on it");
  expect(todo.PPSR.chip).toBe("Problem");
  expect(todo.MORTGAGE.chip).toBe("On hold");
  expect(todo.MORTGAGE.line).toBe("On hold: Waiting for the client's papers · 1 day");
  expect(todo.EDST.chip).toBe("Missing paper");
  await db.loanTransaction.update({ where: { id: notary.id }, data: { status: "COMPLETED", completedAt: new Date(), statusSince: new Date() } });
  todo = await sameWording(page, "EDST");
  expect(todo.NOTARY).toMatchObject({ chip: "Done", clock: null });

  // Selecting rows moves the highlight; the order never changes; the strip keeps the open card in view.
  for (const c of ORDER) {
    await page.goto(`/loans/GD1652026901003?tab=todo&tx=${c}`);
    const list = checkList(page);
    expect(await list.locator("[data-txn]").evaluateAll((els) => els.map((e) => e.getAttribute("data-txn")))).toEqual(ORDER);
    await expect(list.locator(`[data-txn=${c}]`)).toHaveAttribute("aria-current", "true");
    await expect(list.locator("[data-open-now]")).toHaveCount(1);
    await expect(list.locator(`[data-txn=${c}] [data-open-now]`)).toBeVisible();
    if (!wide(page)) await expect(list.locator(`[data-txn=${c}]`)).toBeInViewport(); // the strip scrolls to the open card
    await expect(page.locator("[data-txn-position]").filter({ visible: true }).first()).toContainText(`Transaction ${ORDER.indexOf(c) + 1} of 4`);
    if (c === "NOTARY" || c === "MORTGAGE") await shot(page, `check-docs-${c.toLowerCase()}`);
    await noSideways(page);
  }
  // Keyboard: Enter on a row opens it.
  await checkList(page).locator("[data-txn=PPSR]").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/tx=PPSR/);

  await page.goto("/loans/GD1652026901003?tab=todo");
  await shot(page, "loan-file-todo");
  await noSideways(page);
  // Pressing a row opens Check documents for it.
  await page.locator("[data-txn-row=MORTGAGE] a").click();
  await expect(page).toHaveURL(/tx=MORTGAGE/);
});

test("Counts: 1, 2 and 5 transactions (with a custom type)", async ({ page }) => {
  await signIn(page, "la");
  await openPn3(page);
  const loan = await db.loan.findUniqueOrThrow({ where: { pn: "GD1652026901003" } });
  const custom = await db.transactionType.create({ data: { code: "ZCOURIER", name: "Z Courier pickup", requiresDp: false, ownerRole: "LA", sortOrder: 90 } });
  const extra = await db.loanTransaction.create({ data: { loanId: loan.id, typeId: custom.id } });
  const counts = async (n: number) => {
    await page.goto("/loans/GD1652026901003?tab=todo");
    if (n > 1) await expect(page.locator("[data-all-txns]").getByRole("heading")).toHaveText(`All transactions (${n})`);
    else await expect(page.locator("[data-all-txns]")).toHaveCount(0);
    await page.goto("/loans/GD1652026901003?tab=todo&tx=NOTARY");
    const list = checkList(page);
    if (wide(page)) await expect(list.getByRole("heading", { name: `Transactions (${n})` })).toBeVisible();
    await expect(list.locator("[data-txn]")).toHaveCount(n);
    await noSideways(page);
  };
  await counts(5);
  await expect(checkList(page).locator("[data-txn=ZCOURIER]")).toContainText("Z Courier pickup");
  await db.loanTransaction.updateMany({ where: { id: { in: [extra.id, (await txnOf("EDST")).id, (await txnOf("PPSR")).id] } }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await counts(2);
  await db.loanTransaction.update({ where: { id: (await txnOf("MORTGAGE")).id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await counts(1);
});
