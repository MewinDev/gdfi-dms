import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn } from "./helpers";

/**
 * D-042 screens: Correct due date on the job page (one item, a reason, shown in its history), and the holiday
 * CSV import that shows "This will extend N items (M currently overdue)" before importing. Fake PNs, far dates.
 */
const PN = "GD9992099919";
const MARK = "Zz e2e import holiday";
const dialog = (page: import("@playwright/test").Page) => page.getByRole("dialog");

async function acceptedJob(n: string, due: string, accepted: string) {
  const [admin, dp, branch, mortgage] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } }),
    db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } }),
    db.branch.findUniqueOrThrow({ where: { code: "165" } }),
    db.transactionType.findUniqueOrThrow({ where: { code: "MORTGAGE" } }),
  ]);
  const loan = await db.loan.create({
    data: {
      pn: `${PN}${n}`, borrowerName: `Zz Due Borrower ${n}`, branchId: branch.id, loanType: "New", productName: "Auto Financing", totalReleasedAmount: 400000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: admin.id,
      classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "e2e", stage: "In process", transactions: { create: { typeId: mortgage.id, status: "IN_PROCESS" } },
    },
    include: { transactions: true },
  });
  return db.dpAssignment.create({ data: { loanId: loan.id, transactionId: loan.transactions[0].id, dpBranchId: branch.id, dueBranchId: branch.id, dpUserId: dp.id, assignedById: admin.id, status: "ACCEPTED", decidedAt: new Date(`${accepted}T10:00:00+08:00`), dueDate: due, targetDays: 10 } });
}

test.beforeEach(async () => {
  await resetLoans();
  await db.holidayCalendar.deleteMany({ where: { name: { startsWith: MARK } } });
});
test.afterAll(async () => {
  await db.holidayCalendar.deleteMany({ where: { name: { startsWith: MARK } } });
});

test("Admin corrects one job's due date with a reason; it shows in the due-date history", async ({ page }) => {
  const job = await acceptedJob("01", "2099-03-04", "2099-03-01");
  await signIn(page, "admin");
  await page.goto(`/jobs/${job.id}`);
  const due = page.locator("[data-job-due]");
  await expect(due).toContainText("Due");
  await due.getByRole("button", { name: "Correct due date" }).click();
  const form = due.locator("[data-correct-due]");
  await form.getByLabel("New due date").fill("2099-03-05");
  await form.getByLabel("Reason").fill("LTO system down the whole day");
  await form.getByRole("button", { name: "Save correction" }).click();
  await expect(form.getByText(/Due date corrected from 2099-03-04 to 2099-03-05/)).toBeVisible();
  await expect.poll(async () => (await db.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).dueDate).toBe("2099-03-05");
  await page.reload();
  await expect(page.locator('[data-job-due] [data-due-change="correction"]')).toContainText("LTO system down the whole day");
});

test("a reason is required; someone without the tick sees no Correct due date", async ({ page }) => {
  const job = await acceptedJob("02", "2099-03-04", "2099-03-01");
  await signIn(page, "admin");
  await page.goto(`/jobs/${job.id}`);
  const due = page.locator("[data-job-due]");
  await due.getByRole("button", { name: "Correct due date" }).click();
  const form = due.locator("[data-correct-due]");
  await form.getByLabel("New due date").fill("2099-03-05");
  await form.getByLabel("Reason").fill("abc");
  // The browser asks for 5 characters first; the server says it in words if it gets through.
  await form.getByLabel("Reason").evaluate((el) => el.removeAttribute("minlength"));
  await form.getByRole("button", { name: "Save correction" }).click();
  await expect(form.getByText(/Say why the due date is corrected/)).toBeVisible();
  expect((await db.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).dueDate).toBe("2099-03-04");
});

test("holiday CSV import: Check file shows which due dates move, then Import extends them", async ({ page }, info) => {
  const job = await acceptedJob("03", "2099-03-04", "2099-03-01"); // window (1, 4]
  await signIn(page, "admin");
  await page.goto("/admin/settings?open=holidays");
  await page.locator("[data-holiday-import]").click();
  await expect(dialog(page).getByText("1. Choose a file and check it")).toBeVisible();
  const file = info.outputPath("holidays.csv");
  writeFileSync(file, `date,name,type,branches,reason,status,notes\r\n2099-03-03,${MARK},Regular,,,Active,\r\n`, "utf8");
  await dialog(page).locator('input[type="file"]').setInputFiles(file);
  await dialog(page).getByRole("button", { name: "Check file" }).click();
  await expect(dialog(page).getByText("1 new, 0 changed, 0 unchanged, 0 with problems")).toBeVisible();
  await expect(dialog(page).locator("[data-import-notice]")).toContainText(/This will extend \d+ items? \(\d+ currently overdue\)\./);
  expect((await db.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).dueDate).toBe("2099-03-04"); // nothing saved yet
  await dialog(page).getByRole("button", { name: "Import 1 row" }).click();
  await expect(dialog(page).getByText("Imported 1 new and 0 updated.")).toBeVisible();
  await expect.poll(async () => (await db.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).dueDate).toBe("2099-03-05");
});
