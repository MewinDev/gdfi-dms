import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Signing in, for every spec. Specs must not define their own sign-in (no local signInAs, no inline
 * goto("/login") and click): use signInWith, or signIn for the Loan Associate and the Admin. A copy that
 * clears the cookie while the page is still navigating (after Send or Save) signs in back to that page.
 */
export async function signIn(page: Page, who: "la" | "admin"): Promise<URL> {
  return signInWith(page, who === "admin" ? "Continue as Admin" : "Continue as Loan Associate");
}

/** The Superadmin (D-023): the only role that changes the permission matrix, role ticks and per-user overrides. */
export const SUPERADMIN = { other: "Test Superadmin (Superadmin)" } as const;

/** A test user: the button on the sign-in page ("Continue as Admin"), or a name from the "Other test user" list ("Name (Role)"). */
export type TestUser = string | { other: string };

/**
 * Signs in afresh as a test user. First leaves the current page (about:blank), so a navigation it still
 * had in flight (e.g. the app moving to the next transaction after Send) cannot run without the cookie
 * and land on /login?next=…, which would then send the sign-in back to that page. Waits until the URL
 * has left /login and returns where the role landed: callers that mean to check the landing page do so
 * (an Operations Monitor is sent on from Home to Monitoring).
 */
export async function signInWith(page: Page, who: TestUser): Promise<URL> {
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login$/); // no next=: the sign-in goes to the role's own landing page
  if (typeof who === "string") await page.getByRole("button", { name: who }).click();
  else {
    await page.getByLabel("Other test user").selectOption({ label: who.other });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return new URL(page.url());
}

/** The PN / CIN / CIF box. It is only on the Loans page (and its search results). */
export function visibleSearchBox(page: Page) {
  return page.locator("#find-loan");
}

/** The top bar shown at this width (white on tablet/desktop, navy on phone). */
export function topBar(page: Page) {
  return page.getByRole("banner").filter({ visible: true });
}

/** Types that need LTO processing ask for the office before Send: pick the first one when none is chosen yet. */
export async function pickLtoOffice(page: Page) {
  const lto = page.getByLabel("LTO office", { exact: true }).filter({ visible: true });
  if ((await lto.count()) && !(await lto.first().inputValue())) await lto.first().selectOption({ index: 1 });
}

/** When the send date has passed (it depends on today and the 1-day LA checklist TAT, D-056), Send also needs a late reason: fill it if asked. */
export async function giveLateReason(page: Page) {
  const late = page.getByLabel("Why is this late?").filter({ visible: true });
  if (await late.count()) await late.first().fill("Test run");
}

const phToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
/** A tiny PDF (the stage file check reads the first bytes). */
export const SAMPLE_PDF = { name: "certificate.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n") };

/** Fills the evidence pop-up of the current stage (dates today, text from `values` or "Test ...", ticks on, a small PDF for files) and saves. */
export async function finishCurrentStage(page: Page, values: Record<string, string> = {}) {
  const cur = page.locator("[data-current-stage]");
  await cur.getByRole("button", { name: /^Finish / }).click();
  const dlg = page.getByRole("dialog", { name: /^Finish: / });
  for (const input of await dlg.locator("input[name]:not([type=hidden])").all()) {
    const name = (await input.getAttribute("name")) ?? "";
    const type = await input.getAttribute("type");
    if (type === "checkbox") await input.check();
    else if (type === "file") await input.setInputFiles(SAMPLE_PDF);
    else if (type === "date") await input.fill(values[name] ?? phToday());
    else if (!(await input.inputValue())) await input.fill(values[name] ?? `Test ${name}`);
  }
  await dlg.getByRole("button", { name: "Save and finish" }).click();
  await expect(dlg).toBeHidden();
}

/** DP, on the Job page: works every stage in order. Check and verify ticks each paper. */
export async function workStagesUi(page: Page, values: Record<string, string> = {}) {
  const done = page.locator('[data-stage-stepper] [data-step="done"]');
  for (let i = 0; i < 12; i++) {
    const cur = page.locator("[data-current-stage]");
    if (!(await cur.count())) return;
    const before = await done.count();
    const start = cur.getByRole("button", { name: /^Start / });
    if (await start.count()) {
      await start.click();
      // Started when the page shows the Finish control (or the paper list for Check and verify).
      await expect(cur.getByRole("button", { name: /^Finish / }).or(cur.locator("[data-verify]")).first()).toBeVisible();
    }
    if ((await cur.getAttribute("data-current-stage")) === "VERIFY") {
      const open = cur.locator('[data-verify-paper="open"]');
      while (await open.count()) {
        const n = await open.count();
        await open.first().getByRole("button", { name: /received back and complete/ }).click();
        await expect(open).toHaveCount(n - 1);
      }
      await cur.getByRole("button", { name: "Finish Check and verify" }).click();
    } else {
      await finishCurrentStage(page, values);
    }
    await expect(done).toHaveCount(before + 1);
  }
}

/** DP: Complete job, then Forward to branch (choose the branch, then the named LA, confirm the paper count). */
export async function completeAndForwardUi(page: Page, branch: string, la = "Test Loan Associate") {
  await page.locator("[data-complete-job]").getByRole("button", { name: "Complete job" }).click();
  const fwd = page.locator("[data-forward]");
  await expect(fwd).toBeVisible();
  await fwd.getByLabel("1. Branch").selectOption({ label: branch });
  await fwd.getByLabel("2. Loan Associate").selectOption({ label: la });
  await fwd.getByRole("button", { name: "Forward to branch" }).click();
  await page.getByRole("alertdialog", { name: "Forward the package?" }).getByRole("button", { name: /^Forward \d+ papers?$/ }).click();
  await expect(page.getByText(/Waiting for the Loan Associate to check the papers/)).toBeVisible();
}

/**
 * Funds list: open a row's Details (the chevron; "More" on a phone) and wait until it really is open.
 * A click that lands before the page has hydrated does nothing, so it clicks again until the row says
 * aria-expanded="true". Its label then reads "Hide details of ...".
 */
export async function openFundsDetails(row: Locator) {
  const btn = row.getByRole("button", { name: /^(Show|Hide) details of / });
  await expect(async () => {
    if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * Console errors, page errors and React warnings (a missing key, for example) fail the test: call the
 * returned function at the end. Favicon and "Failed to load resource" lines (a refused request the test
 * makes on purpose) are ignored.
 */
export function watchConsole(page: Page) {
  const bad: string[] = [];
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" || /Warning:|unique "key"/.test(t)) bad.push(t);
  });
  page.on("pageerror", (e) => bad.push(e.message));
  return () => expect(bad.filter((t) => !/favicon|Failed to load resource/.test(t))).toEqual([]);
}

/**
 * The one way an e2e spec takes a documentation screenshot. Normal e2e runs write none (the files in
 * docs/screenshots/ stay as committed); `npm run docs:screenshots` sets DOCS_SCREENSHOTS=1 and refreshes them.
 * tests/e2e-screenshots.test.ts forbids any other .screenshot( call in tests/e2e.
 */
export async function docShot(target: { screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown> }, o: { path: string; fullPage?: boolean }): Promise<void> {
  if (process.env.DOCS_SCREENSHOTS !== "1") return;
  await target.screenshot(o);
}
