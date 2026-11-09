import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { pickLtoOffice } from "./helpers";

/**
 * Second processor (Pasuyo): the LA adds one at Send; the DP passes a job on, choosing what happens
 * to cash held for it. Screenshots go to SHOTS_DIR when it is set.
 */
test.beforeEach(async () => {
  await resetLoans();
});

const BUTTONS = { la: "Continue as Loan Associate", dp: "Continue as Test Document Processor", fin: "Continue as Test Finance" } as const;
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

/** Opens GD1012026901001 and ticks every paper of one transaction. */
async function readyTxn(page: Page, code: string) {
  await page.goto("/search?q=GD1012026901001");
  const open = page.getByRole("main").getByRole("button", { name: "Open loan file" });
  if (await open.count()) { await open.click(); await expect(page).toHaveURL(/\/loans\/GD1012026901001/); }
  await page.goto(`/loans/GD1012026901001?tab=todo&tx=${code}`);
  const group = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await group.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await expect(page.locator('[id^="send-why-"]')).toHaveText(/funds question/);
}

test("LA: Send with a second processor (Pasuyo): reasons beside Send, summary, then the job card shows both", async ({ page }) => {
  await signInAs(page, "la");
  await readyTxn(page, "NOTARY");
  const why = page.locator('[id^="send-why-"]');
  await page.getByText("No funds needed", { exact: true }).click();
  await pickLtoOffice(page);
  await page.locator("label", { hasText: "Test Document Processor" }).click();
  await page.getByRole("button", { name: "Also assign a second processor (Pasuyo)" }).click();
  await expect(why).toHaveText("Pick the second processor");
  await expect(page.getByRole("list", { name: "Ready to send?" }).getByRole("button", { name: "No second processor chosen" })).toBeVisible();
  // A different processor only: the first one is not offered.
  const second = page.getByLabel("Second processor", { exact: true });
  await expect(second.locator("option", { hasText: "Test Document Processor" })).toHaveCount(0);
  await page.getByRole("button", { name: "Choose from another branch" }).last().click();
  await page.getByLabel("Branch", { exact: true }).last().selectOption({ label: "Angono" });
  await second.selectOption((await second.locator("option", { hasText: "Grace Tan" }).getAttribute("value"))!);
  await expect(why).toHaveText("Tell us why a second processor is needed");
  await page.getByLabel("Why is a second processor needed?").fill("Grace is at the Angono notary today");
  await expect(page.getByText(/goes to Test Document Processor \(Antipolo\), with a second processor \(Pasuyo\) Grace Tan \(Angono\), processed at .+\./)).toBeVisible();
  await expect(why).toHaveText("");
  await shot(page, "la-send-pasuyo");
  await noSideways(page);
  await page.getByRole("button", { name: "Send to Test Document Processor" }).click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/tx=EDST/);
  await page.goto("/loans/GD1012026901001?tab=todo&tx=NOTARY");
  const job = page.getByRole("region", { name: "Notary: job" });
  await expect(job.getByText("with a second processor (Pasuyo) Grace Tan")).toBeVisible();
  await expect(job.getByText("Pasuyo", { exact: true })).toBeVisible();
  // Not accepted yet: the LA can still change funds (and the rest) from the Sent card.
  await expect(job.getByRole("button", { name: "Change funds", exact: true })).toBeVisible();
});

test("DP: Pasuyo pop-up asks about held cash first; Hand the balance; Jobs shows the tag; Finance sees it under the second processor", async ({ page }) => {
  // LA sends Mortgage (needs an LTO fee) to the test processor.
  await signInAs(page, "la");
  await readyTxn(page, "MORTGAGE");
  await page.getByText("Needs funds", { exact: true }).click();
  await page.locator("label", { hasText: "LTO fee" }).click();
  await page.locator("label", { hasText: "Test Document Processor" }).click();
  await page.getByLabel("LTO office").selectOption({ index: 1 });
  const late = page.getByLabel("Why is this late?");
  if (await late.count()) await late.fill("Test run");
  await page.getByRole("button", { name: "Send to Test Document Processor" }).click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  const txn = await db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: "GD1012026901001" }, type: { code: "MORTGAGE" } } });
  await expect.poll(async () => (await db.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("ASSIGNED");
  const job = await db.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id } });

  // DP accepts; Finance has released ₱2,000.00 for it (test setup).
  await signInAs(page, "dp");
  await page.goto(`/jobs/${job.id}`);
  await page.getByLabel("Labels are on all papers").check();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("button", { name: /Log today/ })).toBeVisible();
  const dp = await db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  const branch = await db.branch.findUniqueOrThrow({ where: { code: "101" } });
  await db.cashAdvance.create({
    data: {
      number: "CA-2026-9001", requestedById: dp.id, branchId: branch.id, status: "RELEASED", requestedCents: 200000, approvedCents: 200000, releasedCents: 200000,
      approvedAt: new Date(), releasedAt: new Date(), releaseRef: "E2E", liquidationDueAt: new Date(Date.now() + 10 * 86_400_000),
      lines: { create: { transactionId: txn.id, kind: "LTO_FEE", requestedCents: 200000, approvedCents: 200000, releasedCents: 200000 } },
    },
  });
  await page.reload();
  const clockBefore = (await db.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).statusSince;

  await page.getByRole("button", { name: "Pasuyo: pass to another processor" }).click();
  const sheet = page.getByRole("dialog", { name: "Pass to a second processor (Pasuyo)" });
  await expect(sheet.getByText("You hold ₱2,000.00 for this job. What happens to it?")).toBeVisible();
  await sheet.getByLabel("Branch").selectOption({ label: "Angono" });
  const to = sheet.getByLabel("Second processor", { exact: true });
  await to.selectOption((await to.locator("option", { hasText: "Grace Tan" }).getAttribute("value"))!);
  await sheet.getByLabel("Why is a second processor needed?").fill("I am out sick");
  await expect(sheet.getByRole("button", { name: "Pass the job" })).toBeDisabled(); // blocked until a choice
  await shot(page, "dp-pasuyo-popup");
  await noSideways(page);
  await sheet.getByText("Hand the balance to the second processor.").click();
  await expect(sheet.getByRole("button", { name: "Pass the job" })).toBeEnabled();
  await sheet.getByRole("button", { name: "Pass the job" }).click();
  await expect(page.getByRole("heading", { name: "Pasuyo history" })).toBeVisible();
  await expect(page.getByText("Test Document Processor passed it to Grace Tan")).toBeVisible();
  // The TAT clock does not reset: the step start is unchanged.
  expect((await db.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).statusSince).toEqual(clockBefore);

  // Jobs list: the Pasuyo tag.
  await page.goto("/jobs?tab=process");
  const row = page.locator(`[data-job="${job.id}"]`);
  await expect(row.getByText("Pasuyo", { exact: true })).toBeVisible();
  await expect(row).toContainText("from Test Document Processor to Grace Tan");
  await shot(page, "jobs-pasuyo-tag");
  await noSideways(page);

  // Finance: the balance shows under the second processor in Outstanding, with the note.
  await signInAs(page, "fin");
  await page.goto("/funds?tab=outstanding");
  const grace = page.locator("[data-advance]", { has: page.locator(".fl-asked", { hasText: "Grace Tan" }) });
  await expect(grace.locator("[data-amount]")).toHaveText("₱2,000.00");
  // Tablet: the notes sit in For, which opens with each row's Details.
  if ((page.viewportSize()?.width ?? 0) === 820) for (const b of await page.getByRole("button", { name: /^Show details of / }).all()) await b.click();
  await expect(page.getByText(/Handed over from CA-2026-9001 by Test Document Processor \(Pasuyo\)/)).toBeVisible();
  await expect(page.getByText(/₱2,000\.00 handed to Grace Tan/)).toBeVisible();
});
