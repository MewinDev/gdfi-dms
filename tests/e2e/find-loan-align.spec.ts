import { expect, test, type Locator, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, watchConsole, docShot } from "./helpers";

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
  await docShot(page, { path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
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

/** D-059: title, search box and (when given) the result card or message share the left edge; the card spans the
 * filter bar (the search and filter rows) to its right edge. Sample loans are on Home now. */
async function sameEdges(page: Page, result?: Locator) {
  const title = await box(main(page).getByRole("heading", { level: 1, name: "Loans" }));
  const bar = await box(main(page).locator("[data-loans-search]").locator("xpath=.."));
  const input = await box(main(page).locator("[data-loans-search]"));
  expect(Math.abs(input.x - title.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(bar.x - title.x)).toBeLessThanOrEqual(1);
  if (result) {
    const card = await box(result);
    expect(Math.abs(card.x - title.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(right(card) - right(bar))).toBeLessThanOrEqual(1);
  }
}

test.beforeEach(async () => {
  await resetLoans();
});

test("loan found: details and questions share columns, the chosen button fills navy, keyboard focus is a separate gold ring", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/search?q=GD1652026901003");
  const card = main(page).locator("[data-find-preview]");
  await expect(card.locator("[data-find-source]")).toBeVisible();
  await sameEdges(page, card);

  const facts = card.locator("dl > div");
  // Rows of four (the details are checked in myloans-fields.spec.ts).
  await expect(facts).toHaveCount(10); // D-060: + CIN and Classification (not the status in myloans: the chip says it)
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

  // Compact type scale (the user's review, 26 November 2026): fact labels 12px, values 14px semi-bold, question labels 13px.
  const px = (l: Locator) => l.evaluate((e) => getComputedStyle(e).fontSize);
  expect(await px(card.locator("dt").first())).toBe("12px");
  expect(await px(card.locator("dd").first())).toBe("14px");
  expect(await card.locator("dd").first().evaluate((e) => getComputedStyle(e).fontWeight)).toBe("600");
  expect(await px(card.locator("legend").first())).toBe("13px");

  // The answer buttons and Open / Cancel: separate, a 1px border; 44px to tap on a phone, 36px from 768px.
  const tall = width(page) < 768 ? 44 : 36;
  const pill = card.locator("[data-question] label").first();
  const open = card.getByRole("button", { name: "Open loan file" });
  const group = await box(card.locator("[data-question] [data-pills]").first());
  expect(Math.round((await box(pill)).height)).toBeGreaterThanOrEqual(tall);
  expect(Math.round(group.height)).toBe(Math.round((await box(pill)).height));
  expect(await pill.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("1px");
  expect(Math.round((await box(open)).height)).toBe(tall);
  expect(Math.round((await box(card.getByRole("link", { name: "Cancel" }))).height)).toBe(tall);

  // D-060: the hint right beside Open loan file (desktop), under it (phone); Cancel at the end of the row.
  const hint = await box(card.locator("[data-open-hint]"));
  const openBox = await box(open);
  const cancel = await box(card.getByRole("link", { name: "Cancel" }));
  if (width(page) >= 640) {
    expect(hint.x - right(openBox)).toBeGreaterThanOrEqual(0);
    expect(hint.x - right(openBox)).toBeLessThanOrEqual(16);
    expect(Math.abs((hint.y + hint.height / 2) - (openBox.y + openBox.height / 2))).toBeLessThanOrEqual(2);
    expect(Math.abs(right(cancel) - right(q2))).toBeLessThanOrEqual(2);
  } else {
    expect(hint.y).toBeGreaterThan(openBox.y + openBox.height - 1);
    expect(cancel.y).toBeGreaterThan(hint.y);
  }
  // No "Next:" line any more.
  await expect(card.locator("[data-find-next]")).toHaveCount(0);
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
