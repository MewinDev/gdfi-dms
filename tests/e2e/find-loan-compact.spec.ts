import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, watchConsole, docShot } from "./helpers";

/**
 * Find a loan, the compact page: the search row, the slim sample list, one result card, the two
 * questions with Open loan file disabled until both are picked, and the one-line messages.
 * Also: samples only of the person's branches, the dropdown says "Outside your branches", and a result
 * never stays on screen for a different PN than the one in the box.
 * Screenshots at 1440, 820 and 390: docs/screenshots/find-loan-compact/.
 */
const DIR = "docs/screenshots/find-loan-compact";
const width = (page: Page) => page.viewportSize()?.width ?? 0;
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0)); // the sticky top bar stays at the top of the picture
  await docShot(page, { path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
const main = (page: Page) => page.getByRole("main");
const openBtn = (page: Page) => main(page).getByRole("button", { name: "Open loan file" });

test.beforeEach(async () => {
  await resetLoans();
});

test("loan found with both questions: Open loan file disabled until both are picked; no message before trying", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/search?q=GD1652026901003");
  const card = main(page).locator("[data-find-preview]");
  await expect(card.locator("[data-find-source]")).toBeVisible();
  // Only the status and the source on the right; no "all good" chips, no "Next:" line.
  await expect(card.getByRole("list", { name: "Loan status" }).getByRole("listitem")).toHaveText(["Loan Released", "myloans · Not yet in DMS"]);
  for (const gone of ["Your branch", "Details complete", "Source: MyLoans", "Next: we set up the loan file"]) await expect(card.getByText(gone)).toHaveCount(0);
  for (const k of ["Amount released", "Branch", "Released on", "Loan type"]) await expect(card.getByText(k, { exact: true })).toBeVisible();
  await expect(main(page).getByText("What happens next")).toHaveCount(0);
  await expect(main(page).getByText("Nothing to type for documents. We choose them from the loan details.")).toHaveCount(0);

  // Focus goes to the first question.
  const und = main(page).getByRole("radio", { name: "Undertaking", exact: true });
  await expect(und).toBeFocused();
  // Disabled, with one short hint; no per-question message yet.
  await expect(openBtn(page)).toBeDisabled();
  await expect(card.locator("[data-open-hint]")).toHaveText("Answer both questions to open the loan file");
  await expect(card.locator("[data-open-nothing-saved]")).toHaveCount(0);
  await expect(card.locator("[data-setup]")).toHaveCount(0); // nothing set up until both are answered
  await expect(main(page).getByText("Please pick one to continue.")).toHaveCount(0);

  // Side by side on desktop and tablet, stacked on a phone.
  const q1 = (await card.locator('[data-question="financingType"]').boundingBox())!;
  const q2 = (await card.locator('[data-question="orcrStatus"]').boundingBox())!;
  if (width(page) >= 768) expect(Math.abs(q1.y - q2.y)).toBeLessThan(2);
  else expect(q2.y).toBeGreaterThan(q1.y + q1.height - 1);
  // Two separate, equal-width buttons with a gap, 44px tall on a phone, 36px from 768px (compact).
  const [b1, b2] = [(await card.locator('[data-choice="UNDERTAKING"]').boundingBox())!, (await card.locator('[data-choice="NON_UNDERTAKING"]').boundingBox())!];
  expect(b1.height).toBeGreaterThanOrEqual(page.viewportSize()!.width < 768 ? 44 : 36);
  expect(Math.abs(b1.width - b2.width)).toBeLessThanOrEqual(1);
  expect(b2.x - (b1.x + b1.width)).toBeGreaterThanOrEqual(6);
  expect(Math.abs(b1.y - b2.y)).toBeLessThan(2);

  // Arrow keys move inside a question.
  await page.keyboard.press("ArrowRight");
  await expect(main(page).getByRole("radio", { name: "Non-Undertaking" })).toBeChecked();
  await expect(card.locator("[data-open-hint]")).toHaveText("Answer the OR/CR question to open the loan file"); // one still empty
  await noSideways(page);
  await shot(page, "found-questions");
  if (width(page) === 1440) {
    // Everything important is visible without scrolling.
    const bottom = await openBtn(page).evaluate((b) => b.getBoundingClientRect().bottom);
    expect(bottom).toBeLessThan(900);
  }

  // Pressing the disabled button shows the message only for the question left empty, and focuses it.
  await openBtn(page).focus();
  await page.keyboard.press("Enter");
  const orcr = card.locator('[data-question="orcrStatus"]');
  await expect(orcr.getByText("Please pick one to continue.")).toBeVisible();
  await expect(card.locator('[data-question="financingType"]').getByText("Please pick one to continue.")).toHaveCount(0);
  await expect(main(page).getByRole("radio", { name: "Transferred", exact: true })).toBeFocused();
  expect(await db.loan.count()).toBe(0);
  await shot(page, "found-questions-tried");

  await main(page).getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await expect(main(page).getByText("Please pick one to continue.")).toHaveCount(0);
  await expect(card.locator("[data-open-hint]")).toHaveCount(0);
  await expect(card.locator("[data-open-nothing-saved]")).toHaveText("Nothing is saved until you open the loan file.");
  await expect(openBtn(page)).toBeEnabled();
  await openBtn(page).click();
  await expect(page).toHaveURL(/\/loans\/GD1652026901003/);
  clean();
});

test("messages: one compact line each, the PN, and Try again", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  const cases: [string, string, string][] = [
    ["not-found", "GD1012026999999", "No loan with this PN was found in MyLoans."],
    ["outside-branches", "GD3902026901007", "This loan is outside your branches."],
    ["needs-details", "GD1652026901010", "Some loan details in MyLoans need fixing first."],
  ];
  for (const [name, pn, title] of cases) {
    await page.goto(`/search?q=${pn}`);
    const n = main(page).locator("[data-find-problem]");
    await expect(n).toContainText(title);
    await expect(n.locator("[data-notice-pn]")).toHaveText(pn);
    // No row in MyLoans: one sentence, shown once.
    if (name === "not-found") {
      await expect(n.getByText("No loan with this PN was found in MyLoans.")).toHaveCount(1);
      await expect(n).not.toContainText("PN not found");
    } else await expect(n.getByText(/Nothing was saved\./)).toBeVisible();
    if (name === "outside-branches") {
      // The way forward is access to that branch; never "Ask that branch to open it"; no loan details.
      await expect(n).toContainText("To work on this one, ask your Admin to add this branch to your access.");
      await expect(n.locator("[data-outside-branch]")).toHaveText(/^Branch: [A-Z]/);
      await expect(n.getByRole("heading")).toHaveText(pn); // the PN, never the borrower's name
      await expect(n.locator("dl, [data-find-facts]")).toHaveCount(0); // no other details
      await expect(n).not.toContainText("Ask that branch");
      await expect(n).not.toContainText("Outside your branch access.");
    }
    await expect(n.getByRole("link", { name: "Try again" })).toBeVisible();
    // At most about two lines of text (more only on a phone); the outside-branches card has its access panel.
    const h = (await n.boundingBox())!.height;
    expect(h).toBeLessThan(name === "outside-branches" ? (width(page) < 640 ? 340 : 230) : width(page) < 640 ? 180 : 100);
    await noSideways(page);
    await shot(page, `message-${name}`);
  }
  await page.goto("/search?q=GD10120269010");
  await expect(main(page).locator("[data-pn-error] [data-pn-part]")).toHaveText("The running number must be 5 digits (this one has 3).");
  await shot(page, "message-wrong-pn");
  expect(await db.loan.count()).toBe(0);
  clean();
});

