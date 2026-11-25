import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { docShot, signIn, watchConsole } from "./helpers";

/**
 * D-058 readability on every screen: My loans cards (five lines, nothing cut), the search row on a phone, tabs
 * that scroll with a fade, 16px fields and 14px body text on phones, 44px tap targets, and no sideways page
 * scroll from 320px up (360, 390, 820, 1024, 1440 and a landscape phone, 844 x 390).
 * Screenshots (npm run docs:screenshots): My loans, Inbox and Open Items at 390, 820 and 1440 in
 * docs/screenshots/ui-refresh/, the sidebar full and as the rail at 820 and 1440, and the phone's drawer.
 */
const DIR = "docs/screenshots/ui-refresh";
mkdirSync(DIR, { recursive: true });
const width = (page: Page) => page.viewportSize()!.width;
const main = (page: Page) => page.getByRole("main");
const LONG = "Maria Concepcion Dela Cruz-Villanueva y Santiago";
const PREFIX = "GD99920999590";

async function seed() {
  const angono = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  const days = (n: number) => new Date(Date.now() - n * 86_400_000);
  const loans = [
    { name: LONG, type: "Renewal", cls: "FINANCING" as const, released: days(9) },
    { name: "Ramon Garcia", type: "New", cls: "REFINANCING" as const, released: days(0) },
    { name: "Liza Torres", type: "New", cls: "FINANCING" as const, released: days(2) },
  ];
  let i = 0;
  for (const l of loans) {
    i += 1;
    const loan = await db.loan.create({ data: {
      pn: `GD16520269095${String(i).padStart(2, "0")}`, borrowerName: l.name, branchId: angono.id, loanType: l.type, productName: "Auto Refinancing",
      totalReleasedAmount: 1_250_000 + i * 1000, releasedAt: l.released, sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: la.id,
      classification: l.cls, mortgageResult: "MORTGAGE", ruleFired: "MORTGAGE_THRESHOLD:New:MET", stage: "For checklist",
    } });
    if (i === 1) await db.openItem.create({ data: {
      number: "OI-2099-959001", loanId: loan.id, branchId: angono.id, field: "cif", fieldLabel: "CIF", groupKey: null, audience: "BORROWER",
      oldValue: "CIF-0001234", newValue: "CIF-0009876", oldRaw: "CIF-0001234", newRaw: "CIF-0009876",
    } });
  }
  for (const [n, state] of [[1, "POOL"], [2, "POOL"], [3, "INBOX"]] as const) {
    const pn = `${PREFIX}${n}`;
    await db.workItem.create({ data: {
      kind: "LOAN_CANDIDATE", subjectId: pn, role: "LA", branchId: angono.id, pn, label: `${pn}: ${n === 1 ? LONG : "Pedro Santos"}`, state,
      measure: "WAITING", arrivedAt: days(n === 1 ? 3 : 0), ...(state === "INBOX" ? { holderUserId: la.id } : {}),
    } });
  }
}
async function clean() {
  await db.workItem.deleteMany({ where: { pn: { startsWith: PREFIX } } });
}

test.beforeEach(async () => {
  await resetLoans();
  await clean();
  await seed();
});
test.afterAll(async () => {
  await clean();
  await resetLoans();
});

async function noSideways(page: Page, where: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `${where}: scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

test("My loans: five-line cards, nothing cut; PN copies; the whole card opens the loan", async ({ page, context }) => {
  const watch = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/loans?tab=all");
  const card = main(page).locator(`[data-loan-row="GD1652026909501"]`);
  await expect(card).toBeVisible();
  // 1: the long name in full, the deadline chip beside it or, when both do not fit, on the next line (never squeezing the name).
  const name = card.locator("[data-loan-name]");
  await expect(name).toHaveText(LONG);
  expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth && getComputedStyle(e).textOverflow !== "ellipsis")).toBe(true);
  await expect(card.locator("[data-due]")).toContainText(/Late by|Due today|left/);
  const nameW = await name.evaluate((e) => e.getBoundingClientRect().width);
  const rowW = await name.evaluate((e) => e.parentElement!.getBoundingClientRect().width);
  const sameLine = await card.evaluate((c) => Math.abs(c.querySelector("[data-due]")!.getBoundingClientRect().top - c.querySelector("[data-loan-name]")!.getBoundingClientRect().top) < 8);
  if (!sameLine) expect(nameW).toBeGreaterThanOrEqual(rowW - 1); // the chip went under: the name has the whole line
  // 2: the PN, monospace.
  await expect(card.locator("[data-pn]")).toHaveText("GD1652026909501");
  expect(await card.locator("[data-pn]").evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/mono|Consolas|Courier/i);
  // 3, 4, 5.
  await expect(card.locator("[data-branch-amount]")).toContainText(/Angono.*· ₱1,251,000/);
  await expect(card.locator("[data-next-text]")).not.toHaveText("");
  await expect(card.locator('[data-badge="loan-type"]')).toHaveText("Renewal");
  await expect(card.locator('[data-badge="classification"]')).toHaveText("Financing");
  // No "…" anywhere in a card.
  const cut = await main(page).locator("[data-loan-row]").evaluateAll((cards) => cards.flatMap((c) => [...c.querySelectorAll("*")].filter((e) => {
    const s = getComputedStyle(e);
    return s.textOverflow === "ellipsis" || (e.children.length === 0 && e.scrollWidth > e.clientWidth + 1);
  }).map((e) => e.textContent)));
  expect(cut).toEqual([]);
  // Copy the PN (does not open the loan).
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await card.getByRole("button", { name: "Copy PN GD1652026909501" }).click();
  await expect(page).toHaveURL(/\/loans\?tab=all/);
  await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();
  // The whole card opens it: a tap on the branch line lands on the card's link.
  const at = (await card.locator("[data-branch-amount]").boundingBox())!;
  await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
  await expect(page).toHaveURL(/\/loans\/GD1652026909501/);
  watch();
});

test("My loans on a phone: the search is full width, Find loan and Filters below it; tabs scroll with a fade", async ({ page }) => {
  test.skip(width(page) >= 600, "The phone search row.");
  await signIn(page, "la");
  await page.goto("/loans");
  const box = main(page).locator("[data-search-box]");
  const btn = main(page).getByRole("button", { name: "Find loan" });
  const filters = main(page).getByRole("button", { name: /^Filters/ });
  const b = (await box.boundingBox())!;
  const mainBox = (await main(page).boundingBox())!;
  expect(b.width).toBeGreaterThanOrEqual(mainBox.width - 32 - 2); // full width inside the 16px gutters
  await expect(page.locator("#find-loan")).toHaveAttribute("placeholder", "Search PN, name or CIN");
  expect((await btn.boundingBox())!.y).toBeGreaterThan(b.y + b.height - 1);
  expect(Math.abs((await btn.boundingBox())!.y - (await filters.boundingBox())!.y)).toBeLessThanOrEqual(1);
  for (const el of [btn, filters]) expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  // The tabs scroll sideways; the fade shows at the end with more.
  const row = main(page).getByRole("navigation", { name: "Loan lists" });
  const more = await row.evaluate((e) => e.scrollWidth > e.clientWidth);
  if (more) await expect(row.locator("xpath=..")).toHaveAttribute("data-scroll-fade", /end/);
  await expect(row.getByRole("link", { name: /^My queue/ })).toHaveAttribute("aria-current", "page");
});

test("readability: 16px fields and 14px text on phones, 44px tap targets, no sideways scroll from 320px", async ({ page }) => {
  test.skip(width(page) !== 1440, "One run walks every width.");
  test.setTimeout(300_000);
  const sizes = [[320, 640], [360, 780], [390, 844], [844, 390], [820, 1180], [1024, 768], [1440, 900]] as const;
  for (const who of ["la", "admin"] as const) {
    await signIn(page, who);
    const pages = who === "la" ? ["/loans?tab=all", "/inbox", "/inbox?tab=pool", "/dashboard"] : ["/open-items", "/loans?tab=all", "/admin/users"];
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      for (const p of pages) {
        await page.goto(p);
        await page.waitForLoadState("networkidle");
        const where = `${who} ${p} at ${w}x${h}`;
        await noSideways(page, where);
        // Tap targets: the menu button, the bell, the menu links, tabs, the search row's buttons.
        const small = await page.evaluate(() => {
          const sel = "[data-menu-button], header a[href='/notifications'], #main-sidebar a, #main-sidebar button, [data-scroll-row] a, [data-search-submit], [data-loans-toolbar] button, [data-copy]";
          return [...document.querySelectorAll(sel)].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44);
          }).map((e) => `${e.tagName} ${(e.textContent ?? "").trim().slice(0, 30) || e.getAttribute("aria-label")} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
        });
        expect(small, `${where}: tap targets under 44px`).toEqual([]);
        if (w < 768) {
          const fields = await page.evaluate(() => [...document.querySelectorAll("main input:not([type=hidden]):not([type=checkbox]):not([type=radio]), main select, main textarea")]
            .filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => parseFloat(getComputedStyle(e).fontSize)));
          expect(fields.filter((s) => s < 16), `${where}: fields under 16px`).toEqual([]);
          // The card text that matters (name, PN, branch line, next step) is 14px or more.
          const tiny = await page.evaluate(() => [...document.querySelectorAll("[data-loan-name], [data-pn], [data-branch-amount], [data-next-text], [data-inbox-row] a, [data-oi-borrower]")]
            .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 14).map((e) => e.textContent));
          expect(tiny, `${where}: text under 14px`).toEqual([]);
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});

test("screenshots: My loans, Inbox and Open Items", async ({ page }) => {
  const shot = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.evaluate(() => window.scrollTo(0, 0));
    await docShot(page, { path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
  };
  await signIn(page, "la");
  await page.goto("/loans?tab=all");
  await expect(main(page).locator("[data-loan-row]")).toHaveCount(3);
  await shot("my-loans");
  await page.goto("/inbox?tab=pool");
  await expect(main(page).locator("[data-inbox-row]").first()).toBeVisible();
  await shot("inbox-pool");
  await page.goto("/inbox");
  await shot("inbox-mine");
  if (width(page) < 768) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    // After the slide-in.
    await page.waitForFunction(() => { const d = document.getElementById("nav-drawer"); return !!d && Math.round(d.getBoundingClientRect().left) === 0; });
    await page.waitForFunction(() => { const o = document.querySelector("[data-drawer-overlay]"); return !!o && getComputedStyle(o).opacity === "1"; });
    await docShot(page, { path: `${DIR}/menu-drawer-${width(page)}.png` });
    await page.keyboard.press("Escape");
  } else {
    // The sidebar both ways (viewport only): the default first, then after the collapse / expand button.
    const sidebarShot = async () => {
      await page.mouse.move(width(page) - 10, 600); // no tooltip in the picture
      await page.waitForFunction(() => { const s = document.getElementById("main-sidebar"); return !!s && [72, 264].includes(Math.round(s.getBoundingClientRect().width)); });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await docShot(page, { path: `${DIR}/sidebar-${await page.locator("#main-sidebar").getAttribute("data-sidebar")}-${width(page)}.png` });
    };
    await page.goto("/loans?tab=all");
    await sidebarShot();
    await page.locator("[data-nav-collapse]").click();
    await sidebarShot();
    await page.locator("[data-nav-collapse]").click();
  }
  await signIn(page, "admin");
  await page.goto("/open-items");
  await expect(main(page).locator("[data-oi-card]").first()).toBeVisible();
  await shot("open-items");
});
