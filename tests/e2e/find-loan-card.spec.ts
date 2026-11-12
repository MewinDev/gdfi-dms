import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, watchConsole } from "./helpers";

/**
 * Find a loan, the result card: compact (no repeats), the two questions as real buttons (a radio group:
 * one choice each, arrow keys, Space), "What will be set up" with the rule names (no rule numbers), the
 * amber chip only when something is not fine, and the title clear of the sticky top bar.
 * Screenshots at 1440, 820 and 390: docs/screenshots/find-loan-card/.
 */
const DIR = "docs/screenshots/find-loan-card";
const FIN = "GD1652026901003"; // Ana Villanueva, Angono, Renewal ₱1,000,000, Auto Financing: two questions
const REFI = "GD1012026901001"; // Maria Santos, Antipolo, New ₱450,000, Auto Refinancing: no questions
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.getByRole("main");
const card = (page: Page) => main(page).locator("[data-find-preview]");
const openBtn = (page: Page) => main(page).getByRole("button", { name: "Open loan file" });
const setting = (key: string, value: unknown) => db.setting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });

async function shot(page: Page, name: string, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${DIR}/${name}-${width(page)}.png`, fullPage });
}
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
/** The page title is fully visible: below the sticky top bar and inside the window. */
async function titleClear(page: Page) {
  const r = await main(page).getByRole("heading", { level: 1, name: "Find a loan" }).evaluate((h) => {
    const t = h.getBoundingClientRect();
    const bar = Array.from(document.querySelectorAll("header")).find((x) => getComputedStyle(x).position === "sticky" && x.getBoundingClientRect().height > 0);
    return { top: t.top, bottom: t.bottom, barBottom: bar ? bar.getBoundingClientRect().bottom : 0, vh: window.innerHeight };
  });
  expect(r.top).toBeGreaterThanOrEqual(r.barBottom);
  expect(r.bottom).toBeLessThanOrEqual(r.vh);
}

test.beforeEach(async () => {
  await resetLoans();
  await setting("myloans.mockOverrides", {});
});
test.afterAll(async () => {
  await setting("myloans.mockOverrides", {});
  await resetLoans();
});

test("nothing chosen: compact card, separate answer buttons, Open disabled with the missing answer; title visible", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto(`/search?q=${FIN}`);
  const c = card(page);
  await expect(c.locator("[data-find-source]")).toBeVisible();
  await titleClear(page);

  // No repeats: the PN once in the card, no branch or product in the header, no "all good" chips, one subtitle.
  await expect(c.locator("[data-find-pn]")).toHaveText(FIN);
  await expect(c.getByRole("list", { name: "Loan status" }).getByRole("listitem")).toHaveText(["Loan Released", "MyLoans"]);
  await expect(c.locator("[data-find-amber]")).toHaveCount(0);
  for (const gone of ["Your branch", "Details complete", "Next: we set up", "Pick both answers"]) await expect(main(page).getByText(gone)).toHaveCount(0);
  await expect(main(page).getByText("Nothing is saved until you open the loan file.")).toHaveCount(0); // only once both are chosen
  await expect(c.locator("dt")).toHaveCount(8);

  // Two radio groups, labelled by their question; nothing chosen at the start.
  for (const q of ["Is it an Undertaking?", "Is the OR/CR transferred?"]) {
    const g = main(page).getByRole("radiogroup", { name: q });
    await expect(g.getByRole("radio")).toHaveCount(2);
    for (const r of await g.getByRole("radio").all()) await expect(r).not.toBeChecked();
  }
  // Unchosen: white with a visible border, dark text; equal widths with a gap; side by side at every width.
  for (const name of ["financingType", "orcrStatus"]) {
    const [a, b] = await c.locator(`[data-question="${name}"] label`).all();
    const [ba, bb] = [(await a.boundingBox())!, (await b.boundingBox())!];
    expect(ba.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(ba.width - bb.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(ba.y - bb.y)).toBeLessThan(2);
    expect(bb.x - (ba.x + ba.width)).toBeGreaterThanOrEqual(6);
    const s = await a.evaluate((e) => { const x = getComputedStyle(e); return { bg: x.backgroundColor, border: x.borderTopWidth, color: x.color }; });
    expect(s).toMatchObject({ bg: "rgb(255, 255, 255)", border: "1px" });
    expect(s.color).not.toBe("rgb(255, 255, 255)");
  }
  // "Non-Undertaking" fits (it may wrap; never cut off).
  const nu = c.locator('[data-choice="NON_UNDERTAKING"]');
  expect(await nu.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  // The questions side by side at 1440 and 820, stacked at 390.
  const [q1, q2] = [(await c.locator('[data-question="financingType"]').boundingBox())!, (await c.locator('[data-question="orcrStatus"]').boundingBox())!];
  if (width(page) >= 768) expect(Math.abs(q1.y - q2.y)).toBeLessThan(2);
  else expect(q2.y).toBeGreaterThan(q1.y + q1.height - 1);

  await expect(openBtn(page)).toBeDisabled();
  await expect(c.locator("[data-open-hint]")).toHaveText("Choose both answers");
  await expect(c.locator("[data-setup]")).toHaveCount(0);
  if (width(page) === 1440) {
    // The whole card, the questions and the buttons fit a 1440×900 window.
    expect(await c.evaluate((e) => e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(900);
  }
  await noSideways(page);
  await shot(page, "nothing-chosen");
  expect(await db.loan.count()).toBe(0);
  clean();
});

test("both chosen: the buttons fill navy with a check, one choice each, keyboard works; What will be set up; saved as before", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto(`/search?q=${FIN}`);
  const c = card(page);
  const und = main(page).getByRole("radio", { name: "Undertaking", exact: true });
  const non = main(page).getByRole("radio", { name: "Non-Undertaking" });
  await expect(und).toBeFocused(); // focus on arrival, without scrolling the title away
  await titleClear(page);

  // Keyboard: the arrow keys move and choose, Space keeps the choice.
  await page.keyboard.press("ArrowRight");
  await expect(non).toBeChecked();
  await expect(non).toHaveAttribute("aria-checked", "true");
  await expect(und).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("ArrowLeft");
  await expect(und).toBeChecked();
  await page.keyboard.press("Space");
  await expect(und).toBeChecked();
  await expect(non).not.toBeChecked();
  await expect(c.locator("[data-open-hint]")).toHaveText("Choose the OR/CR answer");

  // Clicking the chosen one again keeps it chosen (no empty state); the other one replaces it.
  const trans = c.locator('[data-choice="TRANSFERRED"]');
  await trans.click();
  await trans.click();
  await expect(main(page).getByRole("radio", { name: "Transferred", exact: true })).toBeChecked();
  await c.locator('[data-choice="UNTRANSFERRED"]').click();
  await expect(main(page).getByRole("radio", { name: "Untransferred" })).toBeChecked();
  await expect(main(page).getByRole("radio", { name: "Transferred", exact: true })).not.toBeChecked();
  // Untransferred: no mortgage check.
  await expect(c.locator('[data-setup-rule="ORCR_CHECK"]')).toHaveText("Mortgage check not needed · The OR/CR is untransferred.");
  await expect(c.locator("[data-setup-txns]")).toHaveText("Notary, EDST");
  await trans.click();

  // Chosen: navy fill, white bold text and a check icon (readable without colour).
  for (const v of ["UNDERTAKING", "TRANSFERRED"]) {
    const b = c.locator(`[data-choice="${v}"]`);
    await expect.poll(() => b.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(12, 35, 64)");
    expect(await b.evaluate((e) => { const x = getComputedStyle(e); return [x.color, x.fontWeight]; })).toEqual(["rgb(255, 255, 255)", "700"]);
    await expect(b.locator("svg")).toHaveCount(1);
  }
  for (const v of ["NON_UNDERTAKING", "UNTRANSFERRED"]) await expect(c.locator(`[data-choice="${v}"] svg`)).toHaveCount(0);

  // What will be set up: the classification as one sentence, then title · reason; no rule numbers.
  const setup = c.locator("[data-setup]");
  await expect(setup.locator("[data-setup-txns]")).toHaveText("Notary, EDST, Entry of PPSR, Mortgage");
  await expect(setup.locator("li")).toHaveText([
    "This is a Financing loan: the product name has the word Financing.",
    "Undertaking answer required · This is a Financing loan, answered Undertaking.",
    "Mortgage check needed · The OR/CR is transferred.",
    "Mortgage needed · This is a Renewal loan of ₱1,000,000 or below.",
  ]);
  await expect(main(page)).not.toContainText(/\bRule\s*\d|\bR[1-4]\b/);
  await expect(c.locator("[data-open-hint]")).toHaveCount(0);
  await expect(c.locator("[data-open-nothing-saved]")).toHaveText("Nothing is saved until you open the loan file.");
  await expect(openBtn(page)).toBeEnabled();
  await expect.poll(() => openBtn(page).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(245, 166, 35)");
  await noSideways(page);
  await shot(page, "both-chosen");
  await setup.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await setup.screenshot({ path: `${DIR}/what-will-be-set-up-${width(page)}.png` });

  // Saved exactly as before: the same values; the rule stored by its key.
  await openBtn(page).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${FIN}`));
  const loan = await db.loan.findUniqueOrThrow({ where: { pn: FIN } });
  expect(loan).toMatchObject({ classification: "FINANCING", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED", mortgageResult: "MORTGAGE", ruleFired: "MORTGAGE_THRESHOLD:Renewal:MET" });
  clean();
});

test("Refinancing: nothing to answer, What will be set up at once", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto(`/search?q=${REFI}`);
  const c = card(page);
  await expect(c.getByRole("radiogroup")).toHaveCount(0);
  await expect(c.locator("[data-setup] li")).toHaveText([
    "This is a Refinancing loan: the product name has the word Refinancing.",
    "Mortgage check needed · A Refinancing loan skips the OR/CR question.",
    "Mortgage needed · This is a New loan of ₱500,000 or below.",
  ]);
  await expect(c.locator("[data-open-nothing-saved]")).toBeVisible();
  await expect(openBtn(page)).toBeEnabled();
  await noSideways(page);
  clean();
});

test("an amber chip only when something is not fine: details incomplete (Admin's data check)", async ({ page }) => {
  const clean = watchConsole(page);
  await setting("myloans.mockOverrides", { [REFI]: { areaName: null, areaId: null, changedAt: new Date().toISOString() } });
  await signIn(page, "admin");
  await page.goto(`/search?q=${REFI}`);
  const c = card(page);
  await expect(c.locator("[data-find-amber]")).toHaveText("Details incomplete");
  // The data-check sentence stays (it says what is missing and that opening is not blocked).
  await expect(c.locator("[data-account-warnings]")).toContainText("Area is missing.");
  await expect(c.locator("[data-account-warnings]")).toContainText("Opening is not blocked.");
  // (Admin's role does not open loan files; the line beside the button says so.)
  await expect(c.getByText("Your role does not allow opening loan files.")).toBeVisible();
  await noSideways(page);
  await shot(page, "amber-details-incomplete");
  clean();
});

test("the status cards are unchanged (not released, cancelled)", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/search?q=GD1652026901008");
  const s = main(page).locator("[data-find-status]");
  await expect(s).toBeVisible();
  await expect(s).toContainText("Only released loans can be opened in the DMS. Nothing was saved.");
  await expect(openBtn(page)).toHaveCount(0);
  await titleClear(page);
  await noSideways(page);
  clean();
});
