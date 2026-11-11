import { expect, test, type Locator, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, visibleSearchBox, watchConsole } from "./helpers";

/**
 * Find a loan, alignment: one page container and one grid. Measures bounding boxes so a stray margin or
 * a mismatched width fails here, not only in a screenshot. Screenshots at 1440, 820 and 390:
 * docs/screenshots/find-loan-align/.
 */
const DIR = "docs/screenshots/find-loan-align";
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.getByRole("main");
const box = async (l: Locator) => (await l.boundingBox())!;
const right = (b: { x: number; width: number }) => b.x + b.width;

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
}

/** No sideways scroll, and no visible element in the page sticks out past the right edge. */
async function noOverflow(page: Page) {
  const out = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) bad.push(`page ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    for (const el of Array.from(document.querySelectorAll("main *"))) {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue; // sr-only and empty
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      if (r.right > vw + 0.5 || r.left < -0.5) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${Math.round(r.left)}..${Math.round(r.right)} (width ${vw})`);
    }
    return bad;
  });
  expect(out, out.join("\n")).toEqual([]);
}

/** Title, search box, sample label and (when given) the result card or message share the left edge; the search row and the card share the right edge. */
async function sameEdges(page: Page, result?: Locator) {
  const title = await box(main(page).getByRole("heading", { level: 1, name: "Find a loan" }));
  const row = await box(main(page).locator("[data-find-row]"));
  const input = await box(visibleSearchBox(page).locator("xpath=ancestor::div[@data-find-box]"));
  const sample = await box(main(page).getByRole("heading", { name: "Sample loans" }));
  expect(Math.abs(input.x - title.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(sample.x - title.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(row.x - title.x)).toBeLessThanOrEqual(1);
  if (result) {
    const card = await box(result);
    expect(Math.abs(card.x - title.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(right(card) - right(row))).toBeLessThanOrEqual(1);
  }
}

test.beforeEach(async () => {
  await resetLoans();
});

test("empty page: title, search box and samples share the page edges; the dropdown too", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/search");
  await sameEdges(page);
  // The page uses the same container as My loans: as wide as the main area allows.
  const mainBox = await box(main(page));
  const row = await box(main(page).locator("[data-find-row]"));
  const pad = await main(page).evaluate((m) => parseFloat(getComputedStyle(m).paddingRight));
  expect(Math.abs(right(row) - (right(mainBox) - pad))).toBeLessThanOrEqual(1);
  await noOverflow(page);
  await shot(page, "empty");

  // The suggestions dropdown lines up with the search box on the left and the search row on the right.
  await visibleSearchBox(page).fill("GD3902026901007");
  const panel = page.locator("[data-find-results]");
  await expect(panel).toBeVisible();
  const p = await box(panel);
  const input = await box(main(page).locator("[data-find-box]"));
  expect(Math.abs(p.x - input.x)).toBeLessThanOrEqual(1);
  const edge = width(page) < 640 ? right(input) : right(row);
  expect(Math.abs(right(p) - edge)).toBeLessThanOrEqual(1);
  await noOverflow(page);
  await shot(page, "dropdown");
  clean();
});

test("loan found: one 12-column grid, the selected pill is navy, keyboard focus is a separate gold ring", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/search?q=GD1652026901003");
  const card = main(page).locator("[data-find-preview]");
  await expect(card.getByText("Source: MyLoans")).toBeVisible();
  await sameEdges(page, card);

  const facts = card.locator("dl > div");
  // Two rows of four (the details are checked in myloans-fields.spec.ts).
  await expect(facts).toHaveCount(8);
  const f = await Promise.all([0, 1, 2, 3].map((i) => box(facts.nth(i))));
  const q1 = await box(card.locator('[data-question="financingType"]'));
  const q2 = await box(card.locator('[data-question="orcrStatus"]'));
  if (width(page) >= 768) {
    // Four facts in one row; the questions start at fact 1 and fact 3.
    expect(new Set(f.map((b) => Math.round(b.y))).size).toBe(1);
    expect(Math.abs(q1.x - f[0].x)).toBeLessThanOrEqual(2);
    expect(Math.abs(q2.x - f[2].x)).toBeLessThanOrEqual(2);
  } else {
    // Phone: two facts per row; the questions stacked, full width.
    expect(Math.abs(f[0].y - f[1].y)).toBeLessThan(2);
    expect(f[2].y).toBeGreaterThan(f[0].y + 1);
    expect(Math.abs(f[2].x - f[0].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(q1.x - q2.x)).toBeLessThanOrEqual(1);
    expect(q2.y).toBeGreaterThan(q1.y + q1.height - 1);
    expect(Math.abs(right(q1) - right(f[1]))).toBeLessThanOrEqual(2);
  }

  // Type scale: fact labels 12px, values 16px, question labels 14px.
  const px = (l: Locator) => l.evaluate((e) => getComputedStyle(e).fontSize);
  expect(await px(card.locator("dt").first())).toBe("12px");
  expect(await px(card.locator("dd").first())).toBe("16px");
  expect(await px(card.locator("legend").first())).toBe("14px");

  // Pills and buttons: the same height (44px).
  const pill = card.locator("[data-question] label").first();
  const open = card.getByRole("button", { name: "Open loan file" });
  // The group is 44px; each pill fills it (inside its 1px border and 2px inset).
  const group = await box(card.locator("[data-question] [data-pills]").first());
  expect(Math.round(group.height)).toBe(44);
  expect(Math.round((await box(pill)).height)).toBe(Math.round(group.height) - 6);
  expect(Math.round((await box(open)).height)).toBe(44);
  expect(Math.round((await box(card.getByRole("link", { name: "Cancel" }))).height)).toBe(44);

  // The hint: on the right end of the row (desktop), under the buttons (phone).
  const hint = await box(card.locator("[data-open-hint]"));
  const cancel = await box(card.getByRole("link", { name: "Cancel" }));
  if (width(page) >= 640) {
    expect(hint.x).toBeGreaterThan(right(cancel) + 24);
    expect(Math.abs(right(hint) - right(q2))).toBeLessThanOrEqual(2);
  } else {
    expect(hint.y).toBeGreaterThan(cancel.y + cancel.height - 1);
  }
  // The "Next:" line below a divider.
  expect(await card.locator("[data-find-next]").evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("1px");
  await noOverflow(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await shot(page, "found-nothing-picked");

  // Keyboard: focus shows a gold ring; the answer is not selected by focus alone.
  await card.locator('[data-question="financingType"] input').first().focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const und = card.locator('[data-question="financingType"] label').first();
  const style = (l: Locator) => l.evaluate((e) => { const s = getComputedStyle(e); return { bg: s.backgroundColor, outline: s.outlineStyle, outlineColor: s.outlineColor, outlineWidth: s.outlineWidth, offset: s.outlineOffset }; });
  // (the colours fade in over 150ms: wait for the end)
  await expect.poll(async () => (await style(und)).outlineColor).toBe("rgb(245, 166, 35)");
  const focused = await style(und);
  expect(focused.outline).toBe("solid");
  expect(focused.outlineColor).toBe("rgb(245, 166, 35)");
  expect(focused.outlineWidth).toBe("2px");
  expect(focused.offset).toBe("2px");
  expect(focused.bg).not.toBe("rgb(12, 35, 64)");
  await shot(page, "pill-focus");

  // Selected: navy fill, white text, a check; clearly not the focus ring.
  await page.keyboard.press("Space");
  await expect.poll(async () => (await style(und)).bg).toBe("rgb(12, 35, 64)");
  const sel = await style(und);
  expect(sel.bg).toBe("rgb(12, 35, 64)");
  expect(await und.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(255, 255, 255)");
  await expect(und.locator("svg")).toHaveCount(1);
  await card.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await expect(card.locator("[data-open-hint]")).toHaveCount(0);
  await expect(open).toBeEnabled();
  await expect.poll(() => open.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(245, 166, 35)");
  // Selected, not focused: no ring.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const orcrPill = card.locator('[data-question="orcrStatus"] label').first();
  await expect.poll(async () => (await style(orcrPill)).bg).toBe("rgb(12, 35, 64)");
  const unfocused = await style(orcrPill);
  expect(unfocused.bg).toBe("rgb(12, 35, 64)");
  expect(unfocused.outline).not.toBe("solid");
  await noOverflow(page);
  await shot(page, "found-both-picked");
  expect(await db.loan.count()).toBe(0);
  clean();
});

test("messages: same edges as the page; icon, text and Try again centred", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  const cases: [string, string, string][] = [
    ["not-found", "GD1012026999999", "[data-find-problem]"],
    ["outside-branches", "GD3902026901007", "[data-find-problem]"],
    ["needs-details", "GD1652026901010", "[data-find-problem]"],
    ["wrong-pn", "GD10120269010", "[data-pn-error]"],
  ];
  for (const [name, pn, sel] of cases) {
    await page.goto(`/search?q=${pn}`);
    const n = main(page).locator(sel);
    await expect(n).toBeVisible();
    await sameEdges(page, n);
    if (width(page) >= 640) {
      // Icon, text block and Try again share one vertical centre.
      const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
      const icon = await box(n.locator("[data-notice-icon]"));
      const text = await box(n.locator("[data-notice-text]"));
      const again = await box(n.getByRole("link", { name: "Try again" }));
      expect(Math.abs(mid(icon) - mid(text))).toBeLessThanOrEqual(2);
      expect(Math.abs(mid(again) - mid(text))).toBeLessThanOrEqual(2);
    }
    await noOverflow(page);
    await shot(page, `message-${name}`);
  }
  expect(await db.loan.count()).toBe(0);
  clean();
});
