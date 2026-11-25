import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, signInWith, watchConsole } from "./helpers";

/**
 * D-058: one sidebar, three behaviours, no bottom bar.
 *   Phone (< 768px): the menu button opens a drawer that slides in (overlay; no close button on show: a tap
 *   outside, a swipe left, Esc or choosing a page closes it; focus moves in and stays in, and goes back to the
 *   menu button; keyboard users get a Close menu button that shows only with focus).
 *   Tablet (768 to 1279px): an icon rail with tooltips; Expand widens it, remembered per person.
 *   Desktop (1280px and up): the full sidebar, collapsible to the rail, remembered per person.
 * The collapse button is an icon (tooltip and aria-label) at the top, beside the logo; in the rail, above it.
 * Every width: only the pages the person's permissions allow, count badges on Inbox and Open Items, the active
 * page marked (aria-current); the person (avatar, name, role, branches, a Sign out icon) pinned to the bottom,
 * with the menu scrolling above it. No Away line in the sidebar (Away stays on the Inbox).
 */
const width = (page: Page) => page.viewportSize()!.width;
const sidebar = (page: Page) => page.locator("#main-sidebar");
const drawer = (page: Page) => page.getByRole("dialog", { name: "Menu" });
const menuButton = (page: Page) => page.getByRole("button", { name: "Open menu" });
/** The menu shown at this width: the drawer's on a phone (opened first), the sidebar's otherwise. */
async function shownNav(page: Page) {
  if (width(page) < 768) {
    if (!(await drawer(page).isVisible())) await menuButton(page).click();
    return drawer(page).getByRole("navigation", { name: "Main" });
  }
  return sidebar(page).getByRole("navigation", { name: "Main" });
}
const LA_EMAIL = "test.la@gdfi.ph";

test.beforeEach(async () => {
  // Each test has a fresh browser profile, so the remembered sidebar starts empty.
  await resetLoans();
  await db.workItem.deleteMany({ where: { pn: { startsWith: "GD9992099958" } } });
});
test.afterAll(async () => {
  await db.workItem.deleteMany({ where: { pn: { startsWith: "GD9992099958" } } });
});

test("no bottom bar at any width; the header is one line", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/loans");
  // Nothing fixed to the bottom of the screen holds the menu.
  const bottomNav = await page.evaluate(() => [...document.querySelectorAll("nav")].filter((n) => {
    const s = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    return s.position === "fixed" && r.height > 0 && Math.abs(r.bottom - window.innerHeight) < 2;
  }).length);
  expect(bottomNav).toBe(0);
  const header = page.getByRole("banner").filter({ visible: true });
  await expect(header).toHaveCount(1);
  if (width(page) < 768) {
    await expect(header).toContainText("GDFI DMS");
    await expect(header.getByText("GDFI DMS", { exact: true })).toBeVisible();
    expect(Math.round((await header.boundingBox())!.height)).toBe(56);
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
  } else {
    await expect(header.getByText("Loan Documents Management System", { exact: true })).toBeVisible();
    await expect(menuButton(page)).toBeHidden();
  }
  // The mock myloans banner (test runs use the mock): one line.
  const banner = page.locator("[data-mock-banner]");
  if (await banner.count()) expect((await banner.boundingBox())!.height).toBeLessThanOrEqual(30);
  clean();
});

test("phone: the menu opens a drawer; focus moves in and stays in; Esc, a tap outside, a swipe left and choosing a page close it", async ({ page }) => {
  test.skip(width(page) >= 768, "The drawer is the phone's menu.");
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/loans");
  await expect(sidebar(page)).toBeHidden();
  await expect(drawer(page)).toHaveCount(0);

  // Opens (slides in); focus moves into it, on the current page's link. No close button shows.
  await menuButton(page).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByRole("link", { name: "My loans" })).toBeFocused();
  await expect(drawer(page).getByRole("link", { name: "My loans" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-menu-button]")).toHaveAttribute("aria-expanded", "true");
  expect((await drawer(page).locator("[data-drawer-close]").boundingBox())!.width).toBeLessThanOrEqual(1);
  // Tab and Shift+Tab never leave it.
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
  }
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
  }
  // Keyboard users: the last stop is a "Close menu" button that shows only while it has focus.
  await drawer(page).locator("[data-drawer-close]").focus();
  expect((await drawer(page).locator("[data-drawer-close]").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Enter");
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.locator("[data-menu-button]")).toBeFocused();
  await menuButton(page).click();
  await expect(drawer(page)).toBeVisible();
  // Esc closes; focus back on the menu button.
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.locator("[data-menu-button]")).toBeFocused();
  await expect(page.locator("[data-menu-button]")).toHaveAttribute("aria-expanded", "false");

  // A tap outside (on the overlay) closes.
  await menuButton(page).click();
  await expect(drawer(page)).toBeVisible();
  await page.mouse.click(width(page) - 12, 300);
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.locator("[data-menu-button]")).toBeFocused();

  // A swipe to the left closes.
  await menuButton(page).click();
  await expect(drawer(page)).toBeVisible();
  await drawer(page).evaluate((d) => {
    const t = (x: number) => new Touch({ identifier: 1, target: d, clientX: x, clientY: 300 });
    d.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [t(240)], changedTouches: [t(240)] }));
    d.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [t(120)] }));
  });
  await expect(drawer(page)).toHaveCount(0);

  // Choosing a page goes there and closes.
  await menuButton(page).click();
  await drawer(page).getByRole("link", { name: /^Inbox/ }).click();
  await expect(page).toHaveURL(/\/inbox/);
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  clean();
});

test("tablet: an icon rail with tooltips; Expand shows the labels and is remembered", async ({ page }) => {
  test.skip(width(page) < 768 || width(page) >= 1280, "The rail is the tablet's default.");
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/loans");
  await expect(sidebar(page)).toHaveAttribute("data-sidebar", "rail");
  await expect.poll(async () => Math.round((await sidebar(page).boundingBox())!.width)).toBe(72);
  const loans = sidebar(page).getByRole("link", { name: "My loans" });
  await expect(loans).toHaveAttribute("aria-current", "page");
  // Icons only; the label is still the link's name; a tooltip on hover and on keyboard focus.
  expect(await loans.evaluate((a) => a.getBoundingClientRect().width)).toBeLessThanOrEqual(60);
  await loans.hover();
  await expect(page.getByRole("tooltip")).toHaveText("My loans");
  await sidebar(page).getByRole("link", { name: /^Inbox/ }).focus();
  await expect(page.getByRole("tooltip")).toHaveText(/^Inbox/);

  const toggle = sidebar(page).locator("[data-nav-collapse]");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // Icon only, at the top of the rail (above the logo); the tooltip and the name say what it does.
  await expect(toggle).toHaveAccessibleName("Expand menu");
  await expect(toggle).toHaveText("");
  const [tb, logo] = [(await toggle.boundingBox())!, (await sidebar(page).getByRole("link", { name: "Home" }).first().boundingBox())!];
  expect(tb.y).toBeLessThan(logo.y);
  expect(tb.y).toBeLessThan(40);
  await toggle.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Expand menu");
  // The rail's person block: the avatar (tooltip: name, role, branches) and the Sign out icon.
  const avatar = sidebar(page).locator("[data-nav-avatar]");
  await avatar.hover();
  await expect(page.getByRole("tooltip")).toContainText("Test Loan Associate · Loan Associate");
  await expect(sidebar(page).locator("[data-nav-name]")).toBeHidden();
  await expect(sidebar(page).getByRole("button", { name: "Sign out" })).toBeVisible();
  await toggle.click();
  await expect(sidebar(page)).toHaveAttribute("data-sidebar", "full");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => Math.round((await sidebar(page).boundingBox())!.width)).toBe(264);
  await expect(sidebar(page).getByText("My loans", { exact: true })).toBeVisible();
  // Remembered for this person (localStorage).
  await page.reload();
  await expect(sidebar(page)).toHaveAttribute("data-sidebar", "full");
  await sidebar(page).locator("[data-nav-collapse]").click();
  await expect(sidebar(page)).toHaveAttribute("data-sidebar", "rail");
  await page.reload();
  await expect(sidebar(page)).toHaveAttribute("data-sidebar", "rail");
  clean();
});

test("desktop: the full sidebar, collapsible to the rail and remembered", async ({ page }) => {
  test.skip(width(page) < 1280, "The full sidebar is the desktop's default.");
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/loans");
  await expect(sidebar(page)).toHaveAttribute("data-sidebar", "full");
  await expect.poll(async () => Math.round((await sidebar(page).boundingBox())!.width)).toBe(264);
  const toggle = sidebar(page).locator("[data-nav-collapse]");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAccessibleName("Collapse menu");
  // Icon only, on the logo's line at the top.
  await expect(toggle).toHaveText("");
  const [tb, logo] = [(await toggle.boundingBox())!, (await sidebar(page).getByRole("link", { name: /GDFI DMS/ }).boundingBox())!];
  expect(Math.abs((tb.y + tb.height / 2) - (logo.y + logo.height / 2))).toBeLessThanOrEqual(4);
  expect(tb.x).toBeGreaterThan(logo.x + 40);
  await toggle.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Collapse menu");
  await toggle.click();
  await expect(sidebar(page)).toHaveAttribute("data-sidebar", "rail");
  await page.reload();
  await expect(sidebar(page)).toHaveAttribute("data-sidebar", "rail");
  await sidebar(page).locator("[data-nav-collapse]").click();
  await expect(sidebar(page)).toHaveAttribute("data-sidebar", "full");
  clean();
});

test("only the permitted pages; the person's block pinned to the bottom, the menu scrolling above it", async ({ page }) => {
  const hrefs = async () => (await shownNav(page)).getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")));

  await signIn(page, "la");
  await page.goto("/dashboard");
  const laMenu = await hrefs();
  expect(laMenu.slice(0, 3)).toEqual(["/dashboard", "/inbox", "/loans"]);
  for (const h of ["/jobs", "/funds", "/my-funds", "/admin/users", "/open-items"]) expect(laMenu).not.toContain(h);
  const where = width(page) < 768 ? drawer(page) : sidebar(page);
  const user = where.locator("[data-nav-user]");
  // Sign out: an icon button with a name and a tooltip, in the same block (not its own row).
  const out = user.getByRole("button", { name: "Sign out" });
  await expect(out).toBeVisible();
  await expect(out).toHaveText("");
  // No Away line in the sidebar.
  await expect(where.locator("[data-nav-away]")).toHaveCount(0);
  await expect(where).not.toContainText("set Away");
  if (width(page) < 768 || width(page) >= 1280) {
    await expect(user.locator("[data-nav-name]")).toHaveText("Test Loan Associate");
    await expect(user.locator("[data-nav-role]")).toHaveText("Loan Associate");
    // Two branches: "2 branches", the names in a tooltip.
    const br = user.locator("[data-nav-branches]");
    await expect(br).toContainText("2 branches");
    const nb = (await br.boundingBox())!, ob = (await out.boundingBox())!;
    expect(Math.abs((ob.y + ob.height / 2) - (nb.y + nb.height / 2))).toBeLessThanOrEqual(30); // Sign out sits beside the text
    await br.hover();
    await expect(page.getByRole("tooltip")).toContainText("Antipolo");
    await expect(page.getByRole("tooltip")).toContainText(" · ");
  }
  // Pinned: the block ends at the bottom of the screen; a short screen scrolls the menu, never the block.
  const vh = page.viewportSize()!.height;
  expect(Math.abs((await user.boundingBox())!.y + (await user.boundingBox())!.height - vh)).toBeLessThanOrEqual(16);
  await page.setViewportSize({ width: width(page), height: 360 });
  await expect.poll(async () => { const b = (await user.boundingBox())!; return Math.abs(b.y + b.height - 360) <= 16; }).toBe(true);
  const nav = where.getByRole("navigation", { name: "Main" });
  expect(await nav.evaluate((n) => n.scrollHeight > n.clientHeight)).toBe(true);
  await nav.evaluate((n) => { n.scrollTop = n.scrollHeight; });
  await expect.poll(async () => { const b = (await user.boundingBox())!; return Math.abs(b.y + b.height - 360) <= 16; }).toBe(true);
  await page.setViewportSize({ width: width(page), height: vh });

  await signInWith(page, "Continue as Test Document Processor");
  await page.goto("/jobs");
  const dp = await hrefs();
  expect(dp).toContain("/jobs");
  expect(dp).not.toContain("/loans");
  expect(dp).not.toContain("/admin/users");

  await signIn(page, "admin");
  await page.goto("/admin/users");
  const admin = await hrefs();
  for (const h of ["/open-items", "/admin/users", "/admin/settings", "/admin/audit"]) expect(admin).toContain(h);
  expect(admin).not.toContain("/notifications"); // the bell is enough when there are admin items
  if (width(page) < 768 || width(page) >= 1280) await expect((width(page) < 768 ? drawer(page) : sidebar(page)).locator("[data-nav-branches]")).toHaveText("All branches");
  await expect((await shownNav(page)).getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
});

test("count badges on Inbox and Open Items", async ({ page }) => {
  const la = await db.user.findUniqueOrThrow({ where: { email: LA_EMAIL } });
  const branch = await db.branch.findUniqueOrThrow({ where: { code: "165" } });
  for (const n of [1, 2]) {
    const pn = `GD999209995800${n}`;
    await db.workItem.create({ data: { kind: "LOAN_CANDIDATE", subjectId: pn, role: "LA", branchId: branch.id, pn, label: `${pn}: Badge Borrower ${n}`, state: "INBOX", holderUserId: la.id, measure: "WAITING" } });
  }
  await signIn(page, "la");
  await page.goto("/loans");
  const inbox = (await shownNav(page)).getByRole("link", { name: "Inbox, 2" });
  await expect(inbox).toBeVisible();
  await expect(inbox.locator("[data-nav-badge]")).toHaveText("2");

  // Open Items: the approvers' pending count (Admin approves every branch).
  const loan = await db.loan.create({ data: {
    pn: "GD1652026909901", borrowerName: "Badge Borrower", branchId: branch.id, loanType: "New", productName: "Auto Refinancing",
    totalReleasedAmount: 400000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: la.id,
    classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "MORTGAGE_THRESHOLD:New:MET", stage: "For checklist",
  } });
  await db.openItem.create({ data: {
    number: "OI-2099-958001", loanId: loan.id, branchId: branch.id, field: "cif", fieldLabel: "CIF", groupKey: null, audience: "BORROWER",
    oldValue: "CIF-OLD", newValue: "CIF-NEW", oldRaw: "CIF-OLD", newRaw: "CIF-NEW",
  } });
  await signIn(page, "admin");
  await page.goto("/admin/users");
  const item = (await shownNav(page)).locator('a[href="/open-items"]');
  await expect(item.locator("[data-nav-badge]")).toHaveText(/^[1-9]\d*$/);
  await expect(item).toHaveAccessibleName(/^Open Items, [1-9]/);
});
