import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { approveWithConfirm } from "./approve";
import { openFundsDetails } from "./helpers";

/**
 * "Needs LTO processing" per transaction type and the LTO office everywhere it is needed:
 * Settings switch, LTO office figures, Send (Notary needs it, EDST does not), the Sent card, the DP Job
 * page, and the cash advance request, approval and release lines. Screenshots go to SHOTS_DIR.
 */
const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin", dp: "Continue as Test Document Processor", fin: "Continue as Test Finance" } as const;
const dialog = (page: Page) => page.locator("dialog#settings-modal");

async function signInAs(page: Page, who: keyof typeof BUTTONS) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: BUTTONS[who] }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
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

async function cleanOffices() {
  await db.branch.updateMany({ data: { usualLtoOfficeId: null } });
  await db.ltoOffice.deleteMany({ where: { code: { startsWith: "Z" }, assignments: { none: {} }, advanceLines: { none: {} } } });
  await db.transactionType.updateMany({ where: { code: { in: ["NOTARY", "PPSR", "MORTGAGE"] } }, data: { needsLto: true, requiresDp: true } });
}
test.beforeEach(async () => {
  await resetLoans();
  await cleanOffices();
});
test.afterAll(async () => {
  await resetLoans();
  await cleanOffices();
});

test("Settings: Needs LTO processing follows Needs a processor; LTO chip; LTO office figures and No estimate yet", async ({ page }) => {
  await signInAs(page, "admin");
  await page.goto("/admin/settings?open=transaction-types");
  await expect(dialog(page).getByRole("listitem").filter({ has: page.getByRole("link", { name: "Edit Notary", exact: true }) }).getByText("LTO", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(dialog(page).getByRole("listitem").filter({ has: page.getByRole("link", { name: "Edit For EDST", exact: true }) }).getByText("LTO", { exact: true })).toHaveCount(0);
  await dialog(page).getByRole("link", { name: "Edit Notary" }).click();
  const proc = dialog(page).getByLabel("Needs a processor");
  const lto = dialog(page).getByLabel("Needs LTO processing");
  await expect(lto).toBeChecked();
  await expect(dialog(page).getByText("The Document Processor takes this to an LTO office. The LA must say which office when sending.")).toBeVisible();
  await shot(page, "settings-type-lto");
  await noSideways(page);
  // Turning the processor off switches LTO off, with a note; it stays locked until the processor is back on.
  await proc.uncheck();
  await expect(lto).not.toBeChecked();
  await expect(lto).toBeDisabled();
  await expect(dialog(page).getByText("Switched off: a type without a processor is not taken to the LTO.")).toBeVisible();
  await shot(page, "settings-type-lto-off");
  await proc.check();
  await expect(lto).toBeEnabled();
  await lto.check();
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(dialog(page).getByText("Saved", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  expect((await db.transactionType.findUniqueOrThrow({ where: { code: "NOTARY" } })).needsLto).toBe(true);
  // EDST has no processor: the LTO switch is locked off.
  await page.goto("/admin/settings?open=transaction-types");
  await dialog(page).getByRole("link", { name: "Edit For EDST" }).click();
  await expect(dialog(page).getByLabel("Needs LTO processing")).toBeDisabled();
  await page.goto("/admin/settings?open=transaction-types");

  // LTO offices: the optional figures; an office without them says "No estimate yet".
  await page.goto("/admin/settings?open=lto");
  await dialog(page).getByRole("link", { name: "Add LTO office" }).click();
  await dialog(page).getByLabel("Code").fill("ZLTO-TAL");
  await dialog(page).getByLabel("Name").fill("Z LTO Talisay");
  await dialog(page).getByLabel("Area or city").fill("Talisay");
  await dialog(page).getByLabel("Usual distance (km)").fill("18");
  await dialog(page).getByLabel("Usual travel time (hours, one way)").fill("0.5");
  await dialog(page).getByLabel("Suggested transport amount (₱)").fill("350");
  await expect(dialog(page).getByText("Used only to help the approver estimate the cash advance.")).toBeVisible();
  await shot(page, "lto-office-popup");
  await noSideways(page);
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(page).not.toHaveURL(/edit=/);
  await expect(dialog(page).getByRole("listitem").filter({ hasText: "Z LTO Talisay" })).toContainText("Talisay · about 18 km · usually 0.5 hours · suggested transport ₱350");
  await dialog(page).getByRole("link", { name: "Add LTO office" }).click();
  await dialog(page).getByLabel("Code").fill("ZLTO-NOF");
  await dialog(page).getByLabel("Name").fill("Z LTO No Figures");
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(page).not.toHaveURL(/edit=/);
  await expect(dialog(page).getByRole("listitem").filter({ hasText: "Z LTO No Figures" })).toContainText("No estimate yet");
  await shot(page, "lto-office-list");
  await noSideways(page);
});

test("Send, Sent card, DP Job page and funds: the office and its estimate where they are needed", async ({ page }) => {
  const mandaue = await db.ltoOffice.create({ data: { code: "ZLTO-MAN", name: "Z LTO Mandaue", city: "Mandaue", distanceKm: 25, travelHours: 1, suggestedTransportCents: 60000 } });
  const cebu = await db.ltoOffice.create({ data: { code: "ZLTO-CEB", name: "Z LTO Cebu City" } });

  // LA: open the loan file; the branch's usual LTO office is pre-selected for Notary.
  await signInAs(page, "la");
  await openPn3(page);
  const loan = await db.loan.findUniqueOrThrow({ where: { pn: "GD1652026901003" }, include: { branch: true } });
  await db.branch.update({ where: { id: loan.branchId }, data: { usualLtoOfficeId: mandaue.id } });
  await page.goto("/loans/GD1652026901003?tab=todo&tx=NOTARY");
  const papers = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await papers.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  const why = page.locator('[id^="send-why-"]');
  const ready = page.getByRole("list", { name: "Ready to send?" });
  const office = page.getByLabel("LTO office", { exact: true });
  await expect(office).toHaveValue(mandaue.id);
  const showAll = page.getByRole("button", { name: /^Show all/ });
  if (await showAll.count()) await showAll.click();
  await page.locator("label", { hasText: "Test Document Processor" }).click();
  await page.getByText("Needs funds", { exact: true }).click();
  await page.locator("label", { hasText: "Transport" }).click();
  // No office: the fourth check and the reason beside Send (after papers, funds and processor).
  await office.selectOption("");
  await expect(ready.getByRole("button", { name: "No LTO office chosen" })).toBeVisible();
  await expect(why).toHaveText("Pick the LTO office");
  await expect(page.getByRole("button", { name: /^Send to (?!processor)/ })).toBeDisabled();
  await office.selectOption(mandaue.id);
  await expect(why).toHaveText("");
  await expect(page.getByText(/Notary goes to Test Document Processor \(.+\), processed at Z LTO Mandaue\./)).toBeVisible();
  await shot(page, "send-notary");
  await noSideways(page);
  const late = page.getByLabel("Why is this late?");
  if (await late.count()) await late.fill("Test run");
  await page.getByRole("button", { name: /^Send to (?!processor)/ }).click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  const txn = await db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: "GD1652026901003" }, type: { code: "NOTARY" } } });
  await expect.poll(async () => (await db.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("ASSIGNED");

  // EDST: done by the LA, no processor, so no LTO office is asked.
  await page.goto("/loans/GD1652026901003?tab=todo&tx=EDST");
  await expect(page.getByRole("region", { name: "EDST", exact: true })).toBeVisible();
  await expect(page.getByLabel("LTO office", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "No LTO office chosen" })).toHaveCount(0);
  await shot(page, "send-edst");
  await noSideways(page);

  // Sent card: "At Z LTO Mandaue"; the LA changes the office before the processor accepts.
  await page.goto("/loans/GD1652026901003?tab=todo&tx=NOTARY");
  const job = page.getByRole("region", { name: "Notary: job" });
  await expect(job.locator("[data-lto-chip]")).toHaveText("At Z LTO Mandaue");
  await job.getByRole("button", { name: "Change LTO office" }).click();
  const sheet = page.getByRole("dialog", { name: "Change LTO office" });
  await sheet.getByLabel("LTO office").selectOption(cebu.id);
  await sheet.getByRole("button", { name: "Change office" }).click();
  await expect(job.locator("[data-lto-chip]")).toHaveText("At Z LTO Cebu City");
  const dp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  expect(await db.notification.count({ where: { userId: dp.id, title: { contains: "LTO office changed" } } })).toBe(1);
  // The Transactions list stays short (one pill, one line); the office is in the transaction detail.
  await page.goto("/loans/GD1652026901003?tab=todo");
  await expect(page.locator("[data-txn-row=NOTARY]")).not.toContainText("LTO");
  await page.goto("/loans/GD1652026901003?tab=todo&tx=NOTARY");
  await expect(page.locator("[data-lto-chip]").filter({ visible: true }).first()).toHaveText("At Z LTO Cebu City");

  // DP: accept; "Process at" with the estimate; change it after accepting (a note is required).
  await signInAs(page, "dp");
  const a = await db.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id } });
  await page.goto(`/jobs/${a.id}`);
  const at = page.locator("[data-process-at]");
  await expect(page.locator("#lto-h")).toHaveText(/Process at: Z LTO Cebu City/);
  await expect(at).toContainText("No estimate yet");
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("This job needs funds. Request a cash advance first.")).toBeVisible();
  await at.getByRole("button", { name: "Change LTO office" }).click();
  const dpSheet = page.getByRole("dialog", { name: "Change LTO office" });
  await dpSheet.getByLabel("LTO office").selectOption(mandaue.id);
  await dpSheet.getByRole("button", { name: "Change office" }).click();
  await expect(dpSheet.getByText(/Say why the office is different/)).toBeVisible();
  await dpSheet.getByLabel("Why is it different?").fill("Cebu City office is closed this week");
  await dpSheet.getByRole("button", { name: "Change office" }).click();
  await expect(page.locator("#lto-h")).toHaveText(/Process at: Z LTO Mandaue/);
  await expect(at).toContainText("Mandaue · about 25 km · usually 1 hour · suggested transport ₱600");
  await shot(page, "dp-job-process-at");
  await noSideways(page);
  expect(await db.auditLog.count({ where: { action: "lto_office_changed", entityId: a.id } })).toBe(1);

  // DP: request funds; the line names the office and estimate; Transport comes from the office.
  await page.goto("/my-funds");
  await expect(page.locator("[data-lto-line]")).toHaveText("At Z LTO Mandaue · about 25 km · usually 1 hour · suggested transport ₱600");
  await expect(page.getByRole("textbox", { name: /Transport amount/ })).toHaveValue("600.00");
  await expect(page.getByText(/suggested ₱600\.00 \(from the LTO office\)/)).toBeVisible();
  await shot(page, "request-lto-line");
  await noSideways(page);
  await page.getByRole("button", { name: "Send to Finance" }).click();
  await expect(page.getByText(/sent to Finance for approval/)).toBeVisible();

  // The office changes after the request: the approver sees both.
  await page.goto(`/jobs/${a.id}`);
  await at.getByRole("button", { name: "Change LTO office" }).click();
  await dpSheet.getByLabel("LTO office").selectOption(cebu.id);
  await dpSheet.getByLabel("Why is it different?").fill("Mandaue queue too long, going to Cebu City");
  await dpSheet.getByRole("button", { name: "Change office" }).click();
  await expect(page.locator("#lto-h")).toHaveText(/Process at: Z LTO Cebu City/);

  // Finance: approval and release show the office and estimate per line, and "Office changed".
  await signInAs(page, "fin");
  await page.goto("/funds?tab=approve");
  // Tablet: the For column opens with the row's Details.
  if ((page.viewportSize()?.width ?? 0) === 820) await openFundsDetails(page.locator(".fl-row[id]").first());
  await expect(page.getByText("Z LTO Cebu City · No estimate yet").first()).toBeVisible();
  await expect(page.getByText("Office changed from Z LTO Mandaue to Z LTO Cebu City").first()).toBeVisible();
  await shot(page, "approve-lto-line");
  await noSideways(page);
  await approveWithConfirm(page);
  await expect.poll(async () => (await db.cashAdvance.findFirstOrThrow()).status).toBe("APPROVED");
  await page.goto("/funds?tab=release");
  if ((page.viewportSize()?.width ?? 0) === 820) await openFundsDetails(page.locator(".fl-row[id]").first());
  await expect(page.getByText("Z LTO Cebu City · No estimate yet").first()).toBeVisible();
  await expect(page.getByText("Office changed from Z LTO Mandaue to Z LTO Cebu City").first()).toBeVisible();
  await shot(page, "release-lto-line");
  await noSideways(page);
});
