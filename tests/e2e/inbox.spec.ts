import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInWith, docShot } from "./helpers";
import { db, resetLoans } from "./db";

/**
 * Piece 9 (D-046) screens: the Send panel's Branch DP pool, the Inbox (My items, Branch pool, With people away),
 * Accept, Away, Move (Back to the pool), the pool colours and the supervisors' Home lines.
 * Screenshots (npm run docs:screenshots): docs/screenshots/inbox/.
 */
const DIR = "docs/screenshots/inbox";
mkdirSync(DIR, { recursive: true });
const PN = "GD1652026901003";
const BUTTONS = { la: "Continue as Loan Associate", admin: "Continue as Admin", dp: "Continue as Test Document Processor" } as const;
const txnOf = (code: string) => db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code } } });
const shot = (page: Page, name: string) => docShot(page, { path: `${DIR}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });

async function clearAway() {
  await db.user.updateMany({ where: { email: { in: ["test.la@gdfi.ph", "test.dp@gdfi.ph"] } }, data: { awayFrom: null, awayTo: null, awayNote: "" } });
}
test.beforeEach(async () => {
  await resetLoans();
  await clearAway();
});
test.afterAll(clearAway);

async function openPn(page: Page) {
  await page.goto(`/loans?fill=${PN}`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
  const open = main.getByRole("button", { name: "Open loan file" });
  await expect(async () => {
    await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
    await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
    await expect(open).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await open.click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
}
async function tickAll(page: Page, code: string) {
  await page.goto(`/loans/${PN}?tab=todo&tx=${code}`);
  const group = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await group.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await expect.poll(async () => (await txnOf(code)).status).toBe("READY");
}

test("the LA sends to the Branch DP pool; a processor accepts it from the Inbox and has the normal job", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWith(page, BUTTONS.la);
  await openPn(page);
  await tickAll(page, "NOTARY");
  await page.locator("[data-dp-choice='Branch DP pool']").click();
  await expect(page.getByText(/Any processor of .+ can accept it/)).toBeVisible();
  const lto = page.getByLabel("LTO office", { exact: true }).filter({ visible: true });
  if ((await lto.count()) && !(await lto.first().inputValue())) await lto.first().selectOption({ index: 1 });
  const beyond = page.getByLabel(/Why is this late/);
  if (await beyond.count()) await beyond.fill("Test run");
  await page.getByRole("radio", { name: "No funds needed", exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Send to the branch pool" }).click();
  await page.getByRole("dialog", { name: "Send it now?" }).getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(async () => (await txnOf("NOTARY")).status).toBe("ASSIGNED");
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  await expect(page.locator("[data-pool-line]")).toContainText("DP pool since");
  await expect(page.locator("[data-pool-line]").getByRole("button", { name: "Take it back" })).toBeVisible();

  await signInWith(page, BUTTONS.dp);
  await page.goto("/inbox?tab=pool");
  const row = page.locator("[data-inbox-row]", { hasText: PN }).filter({ hasText: "Processor's job" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Arrived today");
  await shot(page, "branch-pool");
  await row.getByRole("button", { name: "Accept" }).click();
  await expect(page).toHaveURL(/\/jobs\/[a-z0-9]+$/);
  const job = await db.dpAssignment.findFirstOrThrow({ where: { transactionId: (await txnOf("NOTARY")).id }, include: { dpUser: true } });
  expect(job.status).toBe("ACCEPTED");
  expect(job.dpUser.email).toBe("test.dp@gdfi.ph");
  await page.goto("/inbox");
  await expect(page.locator("[data-inbox-row]", { hasText: PN }).filter({ hasText: "Processor's job" })).toContainText("Due");
});

test("My items, Away, the supervisors' Home lines, pool colours and Move back to the pool", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWith(page, BUTTONS.la);
  await openPn(page);
  // Find loan: the LA's items arrive accepted, with a due date.
  await page.goto("/inbox");
  const mine = page.locator("[data-inbox-list='mine'] [data-inbox-row]", { hasText: PN });
  await expect(mine.first()).toContainText("Due");
  await shot(page, "my-items");
  // Away: set by the person.
  await page.locator("[data-away]").getByRole("button", { name: "I will be away" }).click();
  await page.getByLabel("Note (optional)").fill("Sick leave");
  await page.locator("[data-away]").getByRole("button", { name: "Save" }).click();
  await expect(page.locator("[data-away]")).toContainText("Marked away");
  await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } })).awayNote).toBe("Sick leave");

  // A pool item that has waited long (red after 2 working days by default).
  const branch = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  await db.workItem.create({ data: { kind: "LOAN_CANDIDATE", subjectId: "GD9992099930001", role: "LA", branchId: branch.id, pn: "GD9992099930001", label: "GD9992099930001: Zz Waiting Borrower", state: "POOL", measure: "WAITING", arrivedAt: new Date(Date.now() - 10 * 86_400_000) } });

  await signInWith(page, BUTTONS.admin);
  await page.goto("/dashboard");
  const card = page.locator("[data-work-counts]");
  await expect(card.locator("[data-pool-too-long]")).toContainText("1 item waiting in the pool too long");
  await expect(card.locator("[data-with-away]")).toContainText(/items? (is|are) with people who are away/);
  await page.goto("/inbox?tab=pool");
  await expect(page.locator("[data-inbox-row='GD9992099930001: Zz Waiting Borrower'] [data-pool-tone='red']")).toBeVisible();

  // Move one of the away LA's items back to the branch pool.
  await page.goto("/inbox?tab=away");
  const away = page.locator("[data-inbox-list='away'] [data-inbox-row]", { hasText: PN }).first();
  const label = (await away.getAttribute("data-inbox-row"))!;
  await away.getByRole("button", { name: "Move" }).click();
  const form = away.locator("[data-move-form]");
  await form.getByLabel("Move to").selectOption({ label: "Back to the branch pool" });
  await form.getByLabel("Why").fill("Away this week");
  await shot(page, "move");
  await form.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.locator("[data-move-result]")).toContainText("Back in the branch pool.");
  await expect(page.locator(`[data-inbox-list='away'] [data-inbox-row='${label}']`)).toHaveCount(0);
  await expect.poll(async () => (await db.workItem.findFirst({ where: { label, state: "POOL" } }))?.id ?? null).not.toBeNull();
  const old = await db.workItem.findFirstOrThrow({ where: { label, outcome: "BACK_TO_POOL" } });
  expect(old.state).toBe("DONE");
  expect(await db.auditLog.count({ where: { action: "work_item_back_to_pool" } })).toBeGreaterThan(0);
});
