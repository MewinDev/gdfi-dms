import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, visibleSearchBox, watchConsole } from "./helpers";

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
  await page.screenshot({ path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
const main = (page: Page) => page.getByRole("main");
const openBtn = (page: Page) => main(page).getByRole("button", { name: "Open loan file" });

test.beforeEach(async () => {
  await resetLoans();
});

test("empty page: title, one search row, slim samples (one line each, details in the tooltip)", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/search");
  await expect(main(page).getByRole("heading", { level: 1, name: "Find a loan" })).toBeVisible();
  await expect(main(page).getByText("Loan files in the DMS first. A full PN not opened here yet is looked up in MyLoans. Nothing is saved until you open the loan file.")).toBeVisible();
  const box = visibleSearchBox(page);
  await expect(box).toHaveAttribute("placeholder", "PN, CIN or CIF");
  await expect(box).toBeFocused();
  // Input and button: the same height.
  const [b1, b2] = [await box.locator("xpath=..").boundingBox(), await main(page).getByRole("button", { name: "Find loan" }).boundingBox()];
  expect(Math.round(b1!.height)).toBe(Math.round(b2!.height));

  const samples = main(page).getByRole("region", { name: "Sample loans" });
  await expect(samples.getByText("TEST MODE")).toBeVisible();
  if (width(page) < 640) {
    // Phone: folded under one button.
    await samples.getByRole("button", { name: "Show 3" }).click();
  }
  const chips = samples.getByRole("button", { name: /^GD/ });
  await expect(chips).toHaveCount(3);
  const maria = samples.getByRole("button", { name: /Maria Santos/ });
  await expect(maria).toHaveAttribute("title", /No questions\. Mortgage, 4 transactions\./);
  await expect(samples.getByText("No questions. Mortgage, 4 transactions.")).toHaveCount(0);
  // One line each.
  const h = (await maria.boundingBox())!.height;
  expect(h).toBeLessThan(48);
  await noSideways(page);
  await shot(page, "empty");

  // Picking a sample puts its PN in the box; nothing is searched.
  await maria.click();
  await expect(box).toHaveValue("GD1012026901001");
  await expect(page).toHaveURL(/\/search$/);
  expect(await db.loan.count()).toBe(0);
  clean();
});

test("loan found with both questions: Open loan file disabled until both are picked; no message before trying", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/search?q=GD1652026901003");
  const card = main(page).locator("[data-find-preview]");
  await expect(card.getByText("Source: MyLoans")).toBeVisible();
  for (const c of ["Released", "Your branch", "Details complete"]) await expect(card.getByRole("list", { name: "Checks passed" }).getByText(c)).toBeVisible();
  for (const k of ["Amount released", "Branch", "Released on", "Loan type"]) await expect(card.getByText(k, { exact: true })).toBeVisible();
  await expect(card.getByText("Next: we set up the loan file, you check the papers, then send them to a processor.")).toBeVisible();
  await expect(main(page).getByText("What happens next")).toHaveCount(0);
  await expect(main(page).getByText("Nothing to type for documents. We choose them from the loan details.")).toHaveCount(0);

  // Focus goes to the first question.
  const und = main(page).getByRole("radio", { name: "Undertaking", exact: true });
  await expect(und).toBeFocused();
  // Disabled, with one short hint; no per-question message yet.
  await expect(openBtn(page)).toBeDisabled();
  await expect(card.locator("[data-open-hint]")).toHaveText("Pick both answers to continue");
  await expect(main(page).getByText("Please pick one to continue.")).toHaveCount(0);

  // Side by side on desktop and tablet, stacked on a phone.
  const q1 = (await card.locator('[data-question="financingType"]').boundingBox())!;
  const q2 = (await card.locator('[data-question="orcrStatus"]').boundingBox())!;
  if (width(page) >= 768) expect(Math.abs(q1.y - q2.y)).toBeLessThan(2);
  else expect(q2.y).toBeGreaterThan(q1.y + q1.height - 1);
  // Two half-width pills of normal button height.
  const pill = (await card.locator("label", { hasText: /^Undertaking$/ }).boundingBox())!;
  expect(pill.height).toBeLessThan(48);
  expect(pill.width).toBeLessThan(q1.width * 0.55);

  // Arrow keys move inside a question.
  await page.keyboard.press("ArrowRight");
  await expect(main(page).getByRole("radio", { name: "Non-Undertaking" })).toBeChecked();
  await expect(card.locator("[data-open-hint]")).toBeVisible(); // one still empty
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
  await expect(openBtn(page)).toBeEnabled();
  await openBtn(page).click();
  await expect(page).toHaveURL(/\/loans\/GD1652026901003/);
  clean();
});

test("messages: one compact line each, the PN, and Try again", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  const cases: [string, string, string][] = [
    ["not-found", "GD1012026999999", "We could not find this loan in MyLoans."],
    ["not-released", "GD1652026901008", "This loan is not released yet."],
    ["outside-branches", "GD3902026901007", "This loan is outside your branches."],
    ["needs-details", "GD1652026901010", "Some loan details in MyLoans need fixing first."],
  ];
  for (const [name, pn, title] of cases) {
    await page.goto(`/search?q=${pn}`);
    const n = main(page).locator("[data-find-problem]");
    await expect(n).toContainText(title);
    await expect(n.locator("[data-notice-pn]")).toHaveText(pn);
    await expect(n.getByText(/Nothing was saved\./)).toBeVisible();
    await expect(n.getByRole("link", { name: "Try again" })).toBeVisible();
    // At most about two lines of text (more only on a phone).
    const h = (await n.boundingBox())!.height;
    expect(h).toBeLessThan(width(page) < 640 ? 180 : 100);
    await noSideways(page);
    await shot(page, `message-${name}`);
  }
  await page.goto("/search?q=GD10120269010");
  await expect(main(page).locator("[data-pn-error] [data-pn-part]")).toHaveText("The running number must be 5 digits (this one has 3).");
  await shot(page, "message-wrong-pn");
  expect(await db.loan.count()).toBe(0);
  clean();
});

test("the result box clears as soon as the PN in the box changes or a sample is picked", async ({ page }) => {
  await signIn(page, "la");
  await page.goto("/search?q=GD1652026901003");
  const result = main(page).locator("[data-find-result]");
  await expect(result).toContainText("Ana Villanueva");
  await expect(main(page).getByRole("radio", { name: "Undertaking", exact: true })).toBeFocused(); // the page is ready
  const box = visibleSearchBox(page);
  await box.press("End");
  await box.press("Backspace");
  await expect(result).toHaveCount(0);
  await box.pressSequentially("3"); // the same PN again: its result may show again
  await expect(result).toContainText("Ana Villanueva");

  // An error box too.
  await page.goto("/search?q=GD1652026901008");
  await expect(main(page).locator("[data-find-problem]")).toBeVisible();
  await box.fill("GD1652026901004");
  await expect(main(page).locator("[data-find-problem]")).toHaveCount(0);
  await box.press("Enter");
  await expect(page).toHaveURL(/q=GD1652026901004/);
  await expect(result).toContainText("Ramon Garcia");

  // Picking a sample clears it as well (the suggestions close first: Esc).
  await box.press("Escape");
  const samples = main(page).getByRole("region", { name: "Sample loans" });
  if (width(page) < 640) await samples.getByRole("button", { name: "Show 3" }).click();
  await samples.getByRole("button", { name: /Maria Santos/ }).click();
  await expect(box).toHaveValue("GD1012026901001");
  await expect(result).toHaveCount(0);
});

test("the dropdown never asks MyLoans: a whole PN not saved gets the quiet hint, wherever it is", async ({ page }) => {
  // The rest of the dropdown (saved loans, Outside your branches, nothing for random text) is in
  // find-loan-local-first.spec.ts.
  await signIn(page, "la");
  await page.goto("/search");
  const box = visibleSearchBox(page);
  for (const pn of ["GD3902026901007", "GD1012026999999"]) { // Alaminos in MyLoans; not in MyLoans at all
    await box.fill(pn);
    await expect(page.locator("[data-find-unsaved]")).toHaveText("Not opened in the DMS yet. Press Find loan to look it up in MyLoans.");
    await expect(page.locator("[data-find-outside]")).toHaveCount(0);
  }
  await shot(page, "dropdown-unsaved");
});

test("samples: an Angono Loan Associate sees no Antipolo sample", async ({ page }) => {
  const angono = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  const la = await db.role.findUniqueOrThrow({ where: { key: "LA" } });
  await db.user.deleteMany({ where: { email: "zz.find.angono@gdfi.ph" } });
  const u = await db.user.create({ data: { email: "zz.find.angono@gdfi.ph", name: "Zz Angono LA", roleId: la.id, isTestUser: true, homeBranchId: angono.id } });
  await db.userAccessGrant.create({ data: { userId: u.id, kind: "BRANCH", branchId: angono.id } });
  await db.userBranch.create({ data: { userId: u.id, branchId: angono.id } });
  try {
    await page.goto("/login");
    await page.getByLabel("Other test user").selectOption({ label: `Zz Angono LA (${la.name})` });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    for (const url of ["/search", "/loans", "/dashboard"]) {
      await page.goto(url);
      const samples = main(page).getByRole("region", { name: "Sample loans" });
      await expect(samples.getByText("GD1652026901003")).toHaveCount(1);
      await expect(samples.getByText("GD1652026901004")).toHaveCount(1);
      await expect(samples.getByText("GD1012026901001")).toHaveCount(0);
      await expect(samples.getByText("Antipolo")).toHaveCount(0);
    }
    // The real search is unchanged: typing the Antipolo PN is still refused as outside the branches.
    await page.goto("/search?q=GD1012026901001");
    await expect(main(page).locator("[data-find-problem]")).toContainText("This loan is outside your branches.");
  } finally {
    await db.user.delete({ where: { id: u.id } });
  }
});
