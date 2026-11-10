import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";

/**
 * The loan file's Documents tab: one compact card per transaction (two per row when the content is
 * 960 px or wider, one column on a tablet, collapsible cards on a phone), one line per paper (Paper,
 * Type, Label, Where, Print), the custody sentence in a details line, and the All · With you · Not yet
 * filter kept in the address. Printing opens the same label page with the same codes.
 * GD1652026901003: Notary's papers all ticked, one Mortgage paper ticked (so some papers have labels).
 * Test database only. Screenshots: docs/screenshots/documents-tab/ (1440, 820 and 390 px).
 */
const DIR = "docs/screenshots/documents-tab";
mkdirSync(DIR, { recursive: true });
const PN = "GD1652026901003";
/**
 * The Documents tab's content height for the sample loan must stay under these. Before the redesign
 * (one full-width stack, two-line rows) it was 1909 px at 1440, 2148 at 820 and 3410 at 390; the
 * compact cards measure about 758, 1202 and 1398 (1551 on a phone once a second card is opened).
 */
const MAX_HEIGHT: Record<number, number> = { 1440: 1000, 820: 1500, 390: 1800 };

test.beforeEach(async () => {
  await resetLoans();
});

async function signInLa(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue as Loan Associate" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
async function shot(page: Page, name: string, fullPage = true) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${DIR}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
const txnOf = (code: string) => db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code } } });

/** Opens the sample loan; ticks every Notary paper and one Mortgage paper (labels are made for ticked papers). */
async function setUp(page: Page) {
  await signInLa(page);
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
  await page.goto(`/loans/${PN}?tab=todo&tx=NOTARY`);
  const group = page.getByRole("group", { name: /papers$/ }).first();
  for (const box of await group.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await expect.poll(async () => (await txnOf("NOTARY")).status).toBe("READY");
  await page.goto(`/loans/${PN}?tab=todo&tx=MORTGAGE`);
  await page.getByRole("group", { name: /papers$/ }).first().getByRole("checkbox").first().check();
  const mortgage = await txnOf("MORTGAGE");
  await expect.poll(async () => db.documentItem.count({ where: { transactionId: mortgage.id, documentId: { not: null } } })).toBeGreaterThan(0);
}
/** The Documents tab's content height (from the summary line to the last card). */
const tabHeight = (page: Page) => page.evaluate(() => {
  const main = document.querySelector("main")!;
  const tabs = [...main.querySelectorAll("nav")].find((n) => n.getAttribute("aria-label") === "Loan file sections");
  const top = (tabs?.getBoundingClientRect().bottom ?? 0) + window.scrollY;
  return Math.round(main.scrollHeight - top);
});

test("Height of the Documents tab (recorded for the report)", async ({ page }) => {
  test.setTimeout(240_000);
  await setUp(page);
  await page.goto(`/loans/${PN}?tab=documents`);
  await page.waitForLoadState("networkidle");
  const h = await tabHeight(page);
  test.info().annotations.push({ type: "height", description: `${page.viewportSize()!.width}: ${h}` });
  console.log(`DOCUMENTS-TAB-HEIGHT ${page.viewportSize()!.width} ${h}`);
  expect(h).toBeLessThan(MAX_HEIGHT[page.viewportSize()!.width]);
});

const cards = (page: Page) => page.locator("[data-doc-card]");
const width = (page: Page) => page.viewportSize()!.width;
/** The codes the label page shows (the same page every Print opens). */
async function labelCodes(page: Page, href: string) {
  await page.goto(href);
  await expect(page.getByRole("heading", { name: /^Labels for / })).toBeVisible();
  return (await page.locator(".mono.font-bold").allInnerTexts()).sort();
}

test("Documents tab: compact cards, one line per paper, details, filters in the address, the same label printing", async ({ page }) => {
  test.setTimeout(300_000);
  await setUp(page);
  const docs = await db.documentItem.findMany({ where: { loan: { pn: PN } }, include: { transaction: { include: { type: true } } } });
  const labelled = docs.filter((d) => d.documentId);
  await page.goto(`/loans/${PN}?tab=documents`);
  const tab = page.locator("[data-documents-tab]");
  await expect(tab).toContainText(`${labelled.length} of ${docs.length} papers are in your hands and have a label code.`);
  await expect(cards(page)).toHaveCount(4);
  await expect(page.locator('[data-doc-card="NOTARY"] [data-card-count]').filter({ visible: true })).toHaveText(/^\d+ of \d+ with you$/);
  await expect(page.locator("[data-papers-filter-option]")).toHaveText([`All${docs.length}`, `With you${labelled.length}`, `Not yet${docs.length - labelled.length}`]);

  // Layout per width: two cards per row at 1440 (tops aligned), one column at 820, collapsible cards at 390.
  const boxes = await Promise.all((await cards(page).all()).map((c) => c.boundingBox()));
  if (width(page) >= 1440) {
    expect(boxes[0]!.y).toBe(boxes[1]!.y);
    expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + 100);
    expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y);
  } else {
    for (const b of boxes) expect(b!.x).toBe(boxes[0]!.x);
  }
  if (width(page) >= 640) {
    // One line per paper, at most 40 px.
    for (const h of await page.locator("[data-paper-line]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeLessThanOrEqual(40);
    // Not-yet papers are dimmed and keep their word.
    await expect(page.locator('[data-paper-row][data-where-kind="not-yet"] [data-where="not-yet"]').first()).toHaveText("Not yet");
  } else {
    // Phone: the card with papers in hand is open; one with none is closed, its count visible.
    await expect(page.locator('[data-doc-card="NOTARY"] [data-card-toggle]')).toHaveAttribute("aria-expanded", "true");
    const edst = page.locator('[data-doc-card="EDST"]');
    await expect(edst.locator("[data-card-toggle]")).toHaveAttribute("aria-expanded", "false");
    await expect(edst.locator("[data-card-count]").filter({ visible: true })).toHaveText(/^0 of \d+ with you$/);
    await expect(edst.locator("[data-paper-row]").first()).toBeHidden();
    // The Print button is at least 44 px high.
    const btn = page.locator("[data-print-paper]").filter({ visible: true }).first();
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shot(page, "card-collapsed", false);
    await edst.locator("[data-card-toggle]").click();
    await expect(edst.locator("[data-paper-row]").first()).toBeVisible();
  }
  const h = await tabHeight(page);
  console.log(`DOCUMENTS-TAB-HEIGHT ${width(page)} ${h}`);
  expect(h).toBeLessThan(MAX_HEIGHT[width(page)]);
  await noSideways(page);
  await shot(page, "all");

  // Details: press a paper (or Enter): who, where, since when in PHT (not "ago"), the label code.
  const row = page.locator('[data-doc-card="NOTARY"] [data-paper-row]').first();
  const toggle = row.locator("[data-row-toggle]");
  await expect(toggle).toHaveAttribute("title", /, since [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)\./);
  await toggle.click();
  const details = row.locator("[data-row-details]");
  await expect(details).toBeVisible();
  await expect(details).toContainText(/ at the .+, since [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)\./);
  await expect(details).not.toContainText(/ago/);
  await expect(details).toContainText(`Label code ${labelled.find((d) => d.transaction?.type.code === "NOTARY")!.documentId!.slice(0, 15)}`);
  await noSideways(page);
  await shot(page, "row-details-open", false);
  await toggle.press("Enter");
  await expect(details).toBeHidden();
  await toggle.press("Enter");
  await expect(details).toBeVisible();

  // Filters: With you, Not yet; kept in the address after a reload.
  await page.locator('[data-papers-filter-option="with-you"]').click();
  await expect(page).toHaveURL(/papers=with-you/);
  await page.reload();
  await expect(tab).toHaveAttribute("data-papers", "with-you");
  await expect(page.locator("[data-paper-row]")).toHaveCount(labelled.length);
  await expect(page.locator('[data-paper-row]:not([data-where-kind="with-you"])')).toHaveCount(0);
  await noSideways(page);
  await shot(page, "with-you-filter");
  await page.locator('[data-papers-filter-option="not-yet"]').click();
  await expect(page).toHaveURL(/papers=not-yet/);
  await page.reload();
  await expect(tab).toHaveAttribute("data-papers", "not-yet");
  await expect(page.locator("[data-paper-row]")).toHaveCount(docs.length - labelled.length);
  await expect(page.locator('[data-paper-row]:not([data-where-kind="not-yet"])')).toHaveCount(0);
  await noSideways(page);
  await shot(page, "not-yet-filter");

  // Printing opens the same label page with the same codes: one paper, one card, all labels.
  await page.goto(`/loans/${PN}?tab=documents`);
  const one = labelled.find((d) => d.transaction?.type.code === "NOTARY")!;
  const paperHref = await page.locator(`[data-paper-row]`).filter({ hasText: one.label }).first().locator("[data-print-paper]").getAttribute("href");
  expect(paperHref).toBe(`/loans/${PN}/labels?ids=${one.id}`);
  const cardHref = await page.locator('[data-doc-card="NOTARY"] [data-print-card]').first().getAttribute("href");
  const allHref = await page.locator("[data-print-all]").getAttribute("href");
  expect(await labelCodes(page, paperHref!)).toEqual([one.documentId]);
  expect(await labelCodes(page, cardHref!)).toEqual(labelled.filter((d) => d.transaction?.type.code === "NOTARY").map((d) => d.documentId).sort());
  expect(await labelCodes(page, allHref!)).toEqual(labelled.map((d) => d.documentId).sort());
  // The card's button says how many labels it prints; EDST (no labels) has none.
  await page.goto(`/loans/${PN}?tab=documents`);
  await expect(page.locator('[data-doc-card="NOTARY"] [data-print-card]').filter({ visible: true })).toHaveText(`Print labels (${labelled.filter((d) => d.transaction?.type.code === "NOTARY").length})`);
  await expect(page.locator('[data-doc-card="EDST"] [data-print-card]')).toHaveCount(0);
});
