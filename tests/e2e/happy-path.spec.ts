import { expect, test } from "@playwright/test";
import { addDavaoFixture, resetLoans } from "./db";
import { pickLtoOffice, signIn } from "./helpers";

// Each test starts with no loan files and opens its own.
test.beforeEach(async () => {
  await resetLoans();
  await addDavaoFixture();
});

test("LA: find GD1012026901001, open loan file, tick the papers, send to a processor", async ({ page }) => {
  await signIn(page, "la");

  // Find a loan
  await page.goto("/loans");
  const main = page.getByRole("main");
  await main.getByLabel("Find a loan").fill("GD1012026901001");
  await main.getByRole("button", { name: /^Find/ }).click();
  await expect(main.locator("[data-find-source]")).toBeVisible();
  await expect(main.getByText("This is a Refinancing loan: the product name has the word Refinancing.")).toBeVisible();
  await expect(main.getByText("Notary, EDST, Entry of PPSR, Mortgage")).toBeVisible();

  // Open loan file (automatic rules run, no confirmation dialog)
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/GD1012026901001\?tab=transactions/);
  await expect(page.getByText("Loan file opened.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Check the papers for Notary" })).toBeVisible();
  for (const name of ["EDST", "Entry of PPSR", "Mortgage"]) {
    await expect(main.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  }

  // Tick the Notary papers (saved automatically)
  await page.getByRole("link", { name: "Start checking" }).click();
  const notary = page.getByRole("region", { name: "Notary", exact: true });
  for (const item of ["Promissory Note", "Disclosure Statement", "Chattel Mortgage (for notarization)", "Valid IDs of borrower (2)", "Deed of Sale"]) {
    await notary.getByLabel(item).check();
  }
  await expect(notary.getByText("GD1012026901001-PN-01")).toBeVisible();

  // Send to a Document Processor (the recommended one is preselected), then confirm
  await expect(notary.getByText("Recommended")).toBeVisible();
  // The funds question is required before Send (no amount: the processor asks Finance).
  await notary.getByText("No funds needed", { exact: true }).click();
  await pickLtoOffice(page);
  const send = notary.getByRole("button", { name: /^Send to / });
  await expect(send).toBeEnabled();
  await send.click();
  const confirm = page.getByRole("dialog", { name: "Send it now?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Send", exact: true }).click();
  // Sent: the next transaction that needs the LA opens, with a toast.
  await expect(page.getByRole("status").filter({ hasText: "Notary sent. Next: EDST" })).toBeVisible();
  await expect(page).toHaveURL(/tx=EDST/);
  await page.goto("/loans/GD1012026901001?tab=todo&tx=NOTARY");
  await expect(page.getByRole("region", { name: "Notary: job" }).getByText(/Waiting for them to accept\./)).toBeVisible();

  // The sample now says "Opened" (My loans: the samples are one closed row; open it first)
  await page.goto("/loans");
  const samples = page.getByRole("main").locator("[data-home-samples]").first();
  await samples.locator("summary").click();
  await expect(samples.getByRole("button", { name: /Maria Santos/ })).toContainText("Opened");
  await expect(samples.getByRole("button", { name: /Ana Villanueva/ })).toContainText("Try it");

  // The full journey is still available (Journey, Full log)
  await page.goto("/loans/GD1012026901001?tab=journey&journey=log&log=open");
  await expect(page.getByText("Phase 10: Closure, archival, retention")).toBeVisible();

  // Out-of-branch loan file: 404 even by typing the URL
  const res = await page.goto("/loans/GD3902026909007");
  expect(res?.status()).toBe(404);
});
