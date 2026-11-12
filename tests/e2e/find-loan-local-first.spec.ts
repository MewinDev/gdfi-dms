import { expect, test, type Page } from "@playwright/test";
import { addDavaoFixture, db, resetLoans } from "./db";
import { signIn, visibleSearchBox, watchConsole } from "./helpers";

/**
 * Find a loan, local first: the dropdown lists only loan files saved in the DMS (with the name), a quiet
 * hint for a full PN not saved yet, nothing for random text, "Outside your branches" for a saved PN of
 * another branch; the "Already in the DMS" card (no questions) and Open loan file; the two questions for
 * an unsaved loan; part of a PN or a name with the button searches the DMS only. The My loans toolbar
 * and /search behave the same. Typing never asks the server for MyLoans.
 * Screenshots at 1440, 820 and 390: docs/screenshots/find-loan-local-first/.
 */
const DIR = "docs/screenshots/find-loan-local-first";
const SAVED = "GD1012026901001"; // Maria Santos, Antipolo: no questions
const UNSAVED = "GD1652026901003"; // Ana Villanueva, Angono: the two questions
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.getByRole("main");
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
/** Types the text and waits for the dropdown's answer for exactly that text. */
async function typeAndWait(page: Page, text: string) {
  const box = visibleSearchBox(page);
  const answered = page.waitForResponse((r) => r.url().includes("/api/loans/suggest") && new URL(r.url()).searchParams.get("q") === text);
  await box.fill(text);
  await answered;
}
/** Every request the page makes to a MyLoans route (there must be none while typing). */
function myLoansRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (r) => { if (/\/api\/myloans/.test(r.url())) urls.push(r.url()); });
  return urls;
}
async function openSaved(page: Page) {
  await page.goto(`/search?q=${SAVED}`);
  await main(page).getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${SAVED}`));
}

test.beforeEach(async () => {
  await resetLoans();
});

for (const where of ["/loans?find=1", "/search"] as const) {
  test(`dropdown on ${where}: saved loans with the name; the hint for a full unsaved PN; nothing for random text`, async ({ page }) => {
    const clean = watchConsole(page);
    await signIn(page, "la");
    await openSaved(page);
    const calls = myLoansRequests(page);
    await page.goto(where);
    const panel = page.locator("[data-find-results]");

    // Part of a saved PN: the row has the PN, the name, the stage chip and "In DMS".
    await typeAndWait(page, "GD10120269");
    const list = page.getByRole("listbox", { name: "Loan files in the DMS" });
    const row = list.getByRole("option", { name: new RegExp(SAVED) });
    await expect(row).toContainText("Maria Santos");
    await expect(row.locator("[data-find-stage]")).not.toBeEmpty();
    await expect(row.locator("[data-find-in-dms]")).toHaveText("In DMS");
    expect(await list.getByRole("option").count()).toBeLessThanOrEqual(8);
    await expect(row).not.toContainText("₱");
    await noSideways(page);
    if (where === "/search") await shot(page, "dropdown-saved");

    // Part of the borrower's name finds it too.
    await typeAndWait(page, "santos");
    await expect(list.getByRole("option", { name: new RegExp(SAVED) })).toBeVisible();

    // A whole, valid PN not saved yet: one quiet hint, no spinner, no list.
    await typeAndWait(page, UNSAVED);
    await expect(page.locator("[data-find-unsaved]")).toHaveText("Not opened in the DMS yet. Press Find loan to look it up in MyLoans.");
    await expect(list).toHaveCount(0);
    await expect(page.getByText("Looking in MyLoans")).toHaveCount(0);
    if (where === "/search") await shot(page, "dropdown-hint");

    // Random text: nothing at all.
    await typeAndWait(page, "zzzz random");
    await expect(panel).toHaveCount(0);
    expect(calls).toEqual([]);
    clean();
  });
}

test("Outside your branches: a saved PN of another branch, no details", async ({ page }) => {
  await addDavaoFixture();
  await signIn(page, "la");
  await page.goto("/loans?find=1");
  await typeAndWait(page, "GD3902026909007");
  await expect(page.locator("[data-find-outside]")).toHaveText("Outside your branches. You can only open loans of your branches.");
  await expect(page.getByText("E2E Alaminos Fixture")).toHaveCount(0);
  // Its name typed: nothing (another branch's loan files are never listed).
  await typeAndWait(page, "Alaminos Fixture");
  await expect(page.locator("[data-find-results]")).toHaveCount(0);
});

test("Already in the DMS: the card, keyboard pick, Cancel and Open loan file", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await openSaved(page);

  // Keyboard: arrow down, Enter picks the row and shows the card at once.
  await page.goto("/loans?find=1");
  await typeAndWait(page, "Maria");
  await visibleSearchBox(page).press("ArrowDown");
  await visibleSearchBox(page).press("Enter");
  await expect(page).toHaveURL(new RegExp(`/search\\?q=${SAVED}`));
  const card = main(page).locator(`[data-find-saved="${SAVED}"]`);
  await expect(card).toBeVisible();

  // The Find loan button on the whole PN: the same card (no jump to the loan file).
  await page.goto("/search");
  await visibleSearchBox(page).fill(SAVED);
  await visibleSearchBox(page).press("Escape");
  await main(page).getByRole("button", { name: "Find loan" }).click();
  await expect(page).toHaveURL(new RegExp(`/search\\?q=${SAVED}`));
  await expect(card.getByRole("heading", { name: "Maria Santos" })).toBeVisible();
  await expect(card).toContainText(SAVED);
  const chips = card.getByRole("list", { name: "Loan file status" });
  await expect(chips.getByText("Already in the DMS")).toBeVisible();
  await expect(card.locator('[data-saved-fact="Owner"]')).toHaveText("Test Loan Associate");
  await expect(card.locator('[data-saved-fact="Next step"]')).not.toBeEmpty();
  await expect(card.locator('[data-saved-fact="Branch"]')).toHaveText("Antipolo");
  // No questions: they were answered when the loan file was opened.
  await expect(main(page).getByRole("radio")).toHaveCount(0);
  await expect(card.getByRole("link", { name: "Open loan file" })).toBeVisible();
  await expect(card.getByRole("link", { name: "Cancel" })).toBeVisible();
  await noSideways(page);
  await shot(page, "already-in-dms");

  await card.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await page.goto(`/search?q=${SAVED}`);
  await card.getByRole("link", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${SAVED}$`));
  expect(await db.loan.count()).toBe(1);
  clean();
});

test("an unsaved PN from the My loans toolbar: one lookup, the two questions, Open loan file", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/loans?find=1");
  await typeAndWait(page, UNSAVED);
  await visibleSearchBox(page).press("Enter"); // no row picked: Enter presses Find loan
  await expect(page).toHaveURL(new RegExp(`/search\\?q=${UNSAVED}`));
  const preview = main(page).locator("[data-find-preview]");
  await expect(preview.locator("[data-find-source]")).toBeVisible();
  await main(page).getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main(page).getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main(page).getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${UNSAVED}`));
  clean();
});

test("the PN without GD: the hint while typing, then the MyLoans preview; a saved one shows Already in the DMS", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await openSaved(page);
  await page.goto("/loans?find=1");
  await typeAndWait(page, UNSAVED.slice(2));
  await expect(page.locator("[data-find-unsaved]")).toBeVisible();
  await visibleSearchBox(page).press("Enter");
  await expect(main(page).locator("[data-find-preview]").getByText(UNSAVED)).toBeVisible();
  await expect(main(page).locator("[data-pn-error]")).toHaveCount(0);
  await page.goto(`/search?q=${SAVED.slice(2)}`);
  await expect(main(page).locator(`[data-find-saved="${SAVED}"]`)).toBeVisible();
  clean();
});

test("part of a PN or a name with the button: the DMS only; a compact list or Not found in the DMS", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await openSaved(page);
  await page.goto("/search?q=GD10120269");
  const list = main(page).locator("[data-find-list]");
  await expect(list.locator(`[data-find-list-row="${SAVED}"]`)).toContainText("Maria Santos");
  await expect(main(page).locator("[data-find-preview]")).toHaveCount(0);
  await noSideways(page);

  await page.goto(`/search?q=${encodeURIComponent("Zzz Nobody")}`);
  const n = main(page).locator("[data-find-not-saved]");
  await expect(n).toContainText("Not found in the DMS.");
  await expect(n).toContainText("To look it up in MyLoans, type the full PN");
  await noSideways(page);
  await shot(page, "not-found");
  clean();
});
