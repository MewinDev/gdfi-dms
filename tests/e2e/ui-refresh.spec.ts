import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { docShot, signIn, watchConsole } from "./helpers";

/**
 * D-058 readability on every screen: the Loans rows and cards (D-059; nothing cut), the search row on a phone, tabs
 * that scroll with a fade (Inbox, Jobs, Funds, Open Items), 16px fields and 14px body text on phones, 44px tap targets, and no sideways page
 * scroll from 320px up (360, 390, 820, 1024, 1440 and a landscape phone, 844 x 390).
 * Screenshots (npm run docs:screenshots): My loans, Inbox and Open Items at 390, 820 and 1440 in
 * docs/screenshots/ui-refresh/, the sidebar full and as the rail at 820 and 1440, and the phone's drawer.
 * D-062: the loan file (To do, Check documents, Documents, Journey) in the readability walk, and its screenshots
 * (loan-todo, loan-check-documents, loan-documents, loan-journey at 390, 820 and 1440).
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

/** A real loan file with its transactions and papers (the sample myloans' Maria Santos, Antipolo). */
const LOAN_PN = "GD1012026901001";
const LOAN_PAGES = [`/loans/${LOAN_PN}`, `/loans/${LOAN_PN}?tab=todo&tx=NOTARY`, `/loans/${LOAN_PN}?tab=documents`, `/loans/${LOAN_PN}?tab=journey`];
async function openLoanFile(page: Page) {
  await page.goto(`/search?q=${LOAN_PN}`);
  await main(page).getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${LOAN_PN}`));
}

async function noSideways(page: Page, where: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `${where}: scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

test("Loans (D-059, D-060): the row or card in full, nothing cut; PN copies; View details opens the loan, the row does not", async ({ page, context }) => {
  const watch = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/loans");
  const card = main(page).locator(`[data-loan-row="GD1652026909501"]:visible`);
  await expect(card).toBeVisible();
  // The long name in full; on a phone the deadline chip beside it or, when both do not fit, on the next line.
  const name = card.locator("[data-loan-name]");
  await expect(name).toHaveText(LONG);
  expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth && getComputedStyle(e).textOverflow !== "ellipsis")).toBe(true);
  await expect(card.locator("[data-due]")).toContainText(/Late by|Due today|left/);
  if (width(page) < 1024) {
    const nameW = await name.evaluate((e) => e.getBoundingClientRect().width);
    const rowW = await name.evaluate((e) => e.parentElement!.getBoundingClientRect().width);
    const sameLine = await card.evaluate((c) => Math.abs(c.querySelector("[data-due]")!.getBoundingClientRect().top - c.querySelector("[data-loan-name]")!.getBoundingClientRect().top) < 8);
    if (!sameLine) expect(nameW).toBeGreaterThanOrEqual(rowW - 1); // the chip went under: the name has the whole line
    await expect(card.locator("[data-branch-amount]")).toContainText("Angono");
  }
  await expect(card.locator("[data-pn]")).toHaveText("GD1652026909501");
  expect(await card.locator("[data-pn]").evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/mono|Consolas|Courier/i);
  await expect(card.locator("[data-next-text]")).not.toHaveText("");
  await expect(card.locator('[data-badge="loan-type"]')).toHaveText("Renewal");
  await expect(card.locator('[data-badge="classification"]')).toHaveText("Financing");
  // No "…" anywhere in a row or card.
  const cut = await main(page).locator("[data-loan-row]:visible").evaluateAll((cards) => cards.flatMap((c) => [...c.querySelectorAll("*")].filter((e) => {
    const s = getComputedStyle(e);
    if (e.closest(".sr-only")) return false; // read aloud only (the release date is in the title)
    return s.textOverflow === "ellipsis" || (e.children.length === 0 && e.scrollWidth > e.clientWidth + 1);
  }).map((e) => e.textContent)));
  expect(cut).toEqual([]);
  // Copy the PN (does not open the loan).
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await card.getByRole("button", { name: "Copy PN GD1652026909501" }).click();
  await expect(page).toHaveURL(/\/loans$/);
  await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();
  // D-060: the row is not a link; View details is the one way in.
  const at = (await card.locator("[data-next-text]").boundingBox())!;
  await page.mouse.click(at.x + 4, at.y + at.height / 2);
  await expect(page).toHaveURL(/\/loans$/);
  await card.getByRole("link", { name: /^View details of/ }).click();
  await expect(page).toHaveURL(/\/loans\/GD1652026909501/);
  watch();
});

test("Loans on a phone: the search is full width with Search below it; the status chips and Filters wrap, nothing cut", async ({ page }) => {
  test.skip(width(page) >= 600, "The phone search row.");
  await signIn(page, "la");
  await page.goto("/loans");
  const box = main(page).locator("[data-search-box]");
  const btn = main(page).getByRole("button", { name: "Search", exact: true });
  const b = (await box.boundingBox())!;
  const mainBox = (await main(page).boundingBox())!;
  expect(b.width).toBeGreaterThanOrEqual(mainBox.width - 32 - 2); // full width inside the 16px gutters
  await expect(page.locator("#find-loan")).toHaveAttribute("placeholder", "Search PN, name or CIN");
  expect((await btn.boundingBox())!.y).toBeGreaterThan(b.y + b.height - 1);
  for (const el of await main(page).locator("[data-status-option], [data-more-filters]").all()) expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
});

test("readability: 16px fields and 14px text on phones, 44px tap targets, no sideways scroll from 320px", async ({ page }) => {
  test.skip(width(page) !== 1440, "One run walks every width.");
  test.setTimeout(300_000);
  const sizes = [[320, 640], [360, 780], [390, 844], [844, 390], [820, 1180], [1024, 768], [1280, 800], [1366, 768], [1440, 900]] as const; // 1280 and 1366: common office laptops
  for (const who of ["la", "admin"] as const) {
    await signIn(page, who);
    if (who === "la") await openLoanFile(page);
    const pages = who === "la" ? ["/loans", "/inbox", "/inbox?tab=pool", "/dashboard", ...LOAN_PAGES] : ["/open-items", "/loans", "/admin/users"];
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      for (const p of pages) {
        await page.goto(p);
        await page.waitForLoadState("networkidle");
        const where = `${who} ${p} at ${w}x${h}`;
        await noSideways(page, where);
        // From 1280px the Loans table fits its box without its own sideways scroll (below 1440px the release date is
        // the Loan cell's second line instead of a column).
        if (p === "/loans" && w >= 1280) {
          const t = await page.locator("[data-loan-table]").evaluate((e) => ({ over: e.scrollWidth - e.clientWidth, cols: e.querySelectorAll("thead th").length }));
          console.log(`${where}: table over by ${t.over}px, ${t.cols} columns`);
          expect(t.over, `${where}: the Loans table scrolls sideways by ${t.over}px`).toBeLessThanOrEqual(0);
        }
        // Tap targets: the menu button, the bell, the menu links, tabs, the search row's buttons.
        const small = await page.evaluate(() => {
          // Compact controls (D-059: the status chips, Filters, Copy, Accept) keep 44px to tap on a phone with an invisible
          // ::before margin: the tap area is the box plus that margin. From 768px only the menu items, the bell and the
          // search button are held to 44px.
          const phone = window.innerWidth < 768;
          const sel = phone
            ? "[data-menu-button], header a[href='/notifications'], [data-scroll-row] a, [data-search-submit], [data-status-option], [data-more-filters], [data-copy], [data-accept], [data-refresh-loan], [data-ready-go], [data-row-menu], [data-paper-row] label[id^=line-], [data-include]"
            : "header a[href='/notifications'], #main-sidebar a, #main-sidebar button, [data-scroll-row] a, [data-search-submit]";
          const tap = (e: Element) => {
            const r = e.getBoundingClientRect();
            const b = getComputedStyle(e, "::before");
            const out = b.content !== "none" && b.display !== "none" && b.position === "absolute";
            const px = (v: string) => (out && v.endsWith("px") ? Math.max(0, -parseFloat(v)) : 0);
            return { w: r.width + px(b.left) + px(b.right), h: r.height + px(b.top) + px(b.bottom), shown: r.width > 0 && r.height > 0 };
          };
          return [...document.querySelectorAll(sel)].filter((e) => {
            const t = tap(e);
            return t.shown && (t.h < 44 || t.w < 44);
          }).map((e) => `${e.tagName} ${(e.textContent ?? "").trim().slice(0, 30) || e.getAttribute("aria-label")} ${Math.round(tap(e).w)}x${Math.round(tap(e).h)}`);
        });
        expect(small, `${where}: tap targets under 44px`).toEqual([]);
        if (w < 768) {
          const fields = await page.evaluate(() => [...document.querySelectorAll("main input:not([type=hidden]):not([type=checkbox]):not([type=radio]), main select, main textarea")]
            .filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => parseFloat(getComputedStyle(e).fontSize)));
          expect(fields.filter((s) => s < 16), `${where}: fields under 16px`).toEqual([]);
          // The card text that matters (name, PN, branch line, next step) is 14px or more.
          const tiny = await page.evaluate(() => [...document.querySelectorAll("[data-loan-name], [data-pn], [data-branch-amount], [data-next-text], [data-inbox-row] a, [data-oi-borrower], [data-borrower], [data-paper-name], [data-txn-hint], [data-loan-header] dd")]
            .filter((e) => (e as HTMLElement).offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 14).map((e) => e.textContent)); // shown ones (the table is hidden on a phone)
          expect(tiny, `${where}: text under 14px`).toEqual([]);
        }
        // D-062: the loan file's header and paper rows: nothing cut (no "…", no text wider than its box).
        if (p.startsWith("/loans/")) {
          const cut = await page.evaluate(() => [...document.querySelectorAll("[data-loan-header] h1, [data-loan-header] dd, [data-loan-header] [data-pn], [data-paper-name], [data-txn-hint], [data-step-title]")]
            .filter((e) => (e as HTMLElement).offsetParent !== null && (e.scrollWidth > e.clientWidth + 1)).map((e) => e.textContent));
          expect(cut, `${where}: text cut`).toEqual([]);
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});

test("screenshots: the loan file (D-062): To do, Check documents, Documents and Journey", async ({ page }) => {
  const shot = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // the dev server's badge (a dev run), never in the picture
    await page.evaluate(() => window.scrollTo(0, 0));
    await docShot(page, { path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
  };
  await signIn(page, "la");
  await openLoanFile(page);
  await page.goto(`/loans/${LOAN_PN}`);
  await expect(main(page).locator("[data-loan-header]")).toBeVisible();
  await shot("loan-todo");
  await page.goto(`/loans/${LOAN_PN}?tab=todo&tx=NOTARY`);
  await expect(main(page).locator("[data-txn-hint]")).toBeVisible();
  await shot("loan-check-documents");
  await page.goto(`/loans/${LOAN_PN}?tab=documents`);
  await expect(main(page).locator("[data-documents-tab]")).toBeVisible();
  await shot("loan-documents");
  await page.goto(`/loans/${LOAN_PN}?tab=journey`);
  await expect(main(page).locator("[data-journey]")).toBeVisible();
  await shot("loan-journey");
});

test("screenshots: My loans, Inbox and Open Items", async ({ page }) => {
  const shot = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.evaluate(() => window.scrollTo(0, 0));
    await docShot(page, { path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
  };
  await signIn(page, "la");
  await page.goto("/loans");
  await expect(main(page).locator("[data-loan-row]:visible")).toHaveCount(3); // 3 loan files (the pool items only with Not yet in DMS, D-060)
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
    await page.goto("/loans");
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
