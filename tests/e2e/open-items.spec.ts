import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn } from "./helpers";

/**
 * Check documents: one alert place. No banners on the left; the grouped Open items card (Waiting for
 * papers, On hold, Problems): a missing paper or a returned row is itself the button (Show paper, Open); holds and
 * problems keep their one button (Resume, Open). Ask for missing paper
 * (specific unticked papers, asked from, optional hold), Put on hold (purpose and example), the
 * Requested tag with who and when, title chips, side chips and strip dots. No "Pending" wording.
 * Screenshots go to SHOTS_DIR when it is set. No sideways page scroll.
 */
test.beforeEach(async () => {
  await resetLoans();
});

const wide = (page: Page) => page.viewportSize()!.width >= 1100;
async function shot(page: Page, name: string, fullPage = true) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
const toast = (page: Page) => page.locator("[data-live-toast]");
/** The Open items list at this width (card on desktop; the one-line summary, opened, on tablet and phone). */
async function openItems(page: Page) {
  if (wide(page)) return page.locator('[data-open-items="card"]');
  const box = page.locator('[data-open-items="collapsible"]');
  if (!(await box.evaluate((d) => (d as HTMLDetailsElement).open))) await box.locator("summary").click();
  return box;
}
const txnOf = (code: string) => db.loanTransaction.findFirstOrThrow({ where: { loan: { pn: "GD1652026901003" }, type: { code } } });
async function addProblem(code: string, daysAgo: number) {
  const t = await txnOf(code);
  const reason = await db.problemReason.findUniqueOrThrow({ where: { code: "LTO_DOWN" } });
  await db.problem.create({ data: { loanId: t.loanId, transactionId: t.id, reasonId: reason.id, raisedByLabel: "Test Document Processor", raisedAt: new Date(Date.now() - daysAgo * 86_400_000) } });
}
async function openPn3(page: Page) {
  await page.goto("/loans?fill=GD1652026901003");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Find/ }).click();
  await main.getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main.getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main.getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(/\/loans\/GD1652026901003/);
}
/** The title chips of the selected transaction (header row on tablet and desktop, under it on phone). */
const titleChips = (page: Page) => page.locator("[data-title-chip]").filter({ visible: true });

test("One alert place: the Open items card, the missing-paper and Put on hold pop-ups", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "la");
  await openPn3(page);
  await page.goto("/loans/GD1652026901003?tab=todo&tx=NOTARY");
  await expect(page.locator("[data-open-items]")).toHaveCount(0); // nothing open: no card
  const papers = page.getByRole("group", { name: "Notary papers" });
  await papers.getByLabel("Disclosure Statement").check();
  await expect(page.getByText("All changes saved").or(page.getByText("Saved just now")).first()).toBeVisible();

  // Ask for missing paper: only unticked papers of Notary, at least one, the hold box off by default.
  await page.getByRole("button", { name: "Ask for missing paper" }).click();
  const ask = page.getByRole("dialog", { name: "Ask for missing paper" });
  await expect(ask.locator("[data-purpose]")).toHaveText(/does not stop the work and does not pause the turnaround time\. It closes by itself when the paper is ticked\./);
  await expect(ask.getByRole("checkbox", { name: "Disclosure Statement" })).toHaveCount(0);
  await expect(ask.getByRole("checkbox", { name: "Promissory Note" })).toBeVisible();
  await expect(ask.locator("[data-now-line]")).toHaveText(/^Asked now: .+ PHT$/);
  const askBtn = ask.getByRole("button", { name: "Ask for the paper" });
  await expect(askBtn).toBeDisabled();
  const alsoHold = ask.getByRole("checkbox", { name: /Also put this transaction on hold/ });
  await expect(alsoHold).not.toBeChecked();
  await ask.getByRole("checkbox", { name: "Promissory Note" }).check();
  await ask.getByRole("radio", { name: "Borrower" }).check();
  await alsoHold.check();
  await shot(page, "missing-paper-popup", false);
  await askBtn.click();
  await expect(toast(page)).toHaveText(/Missing paper requested: Promissory Note · On hold: Waiting for the client's papers/);
  await expect(page.locator("[data-live-announcer]").first()).toHaveText(/Missing paper requested: Promissory Note/);
  // Two separate records: the request and the hold.
  const notary = await txnOf("NOTARY");
  expect(await db.loanException.count({ where: { transactionId: notary.id, type: "LEGAL_DOCS_COMPLETION", status: "OPEN" } })).toBe(1);
  expect(await db.hold.count({ where: { transactionId: notary.id, resumedAt: null } })).toBe(1);

  // No banners on the left except the one hold summary (reason and remarks); the Requested tag (who and when), the title chips.
  await expect(page.locator("[data-open-banners]")).toHaveCount(0);
  await expect(page.locator("[data-hold-summary]")).toHaveCount(1);
  await expect(page.locator("[data-hold-summary] blockquote[data-remarks]")).toHaveText("Missing paper: Promissory Note");
  const tag = papers.locator("[data-requested]");
  await expect(tag).toHaveCount(1);
  await expect(tag).toHaveAttribute("title", /^Asked by Test Loan Associate · [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s?[AP]M PHT · from Borrower$/); // the date and time, for the TAT
  await tag.focus();
  await expect(tag.getByRole("tooltip")).toBeVisible();
  await expect(titleChips(page)).toHaveCount(0); // the "Do this now" card says it: no chip beside the title

  // Put on hold (Mortgage): purpose and a one-line example for the chosen reason.
  await page.goto("/loans/GD1652026901003?tab=todo&tx=MORTGAGE");
  await page.getByRole("button", { name: "Put on hold" }).click();
  const hold = page.getByRole("dialog", { name: "Put on hold" });
  await expect(hold.locator("[data-purpose]")).toHaveText("Use this when the work is waiting on something outside your hands, for example the borrower or an LTO appointment. It is not a fault. The turnaround time keeps counting.");
  await expect(hold.getByRole("button", { name: "Put on hold" })).toBeDisabled();
  await hold.getByLabel("Reason").selectOption({ label: "No available DP" });
  await expect(hold.locator("[data-reason-example]")).toHaveText("For example: no processor is free in the branch until Monday.");
  await expect(hold.getByRole("button", { name: "Put on hold" })).toBeDisabled(); // remarks are always required
  await hold.getByLabel("Remarks (required)").fill("LTO set the appointment for Monday");
  await shot(page, "put-on-hold-popup", false);
  await hold.getByRole("button", { name: "Put on hold" }).click();
  await expect(toast(page)).toHaveText(/Mortgage put on hold: No available DP/);

  // Problems on PPSR and Notary. On Notary the "Do this now" card says Notary's hold, problem and
  // missing paper (once); the Open items card lists only the other transactions.
  await addProblem("PPSR", 2);
  await addProblem("NOTARY", 1);
  await page.goto("/loans/GD1652026901003?tab=todo&tx=NOTARY");
  const doNow = page.locator("[data-do-now]");
  await expect(doNow.locator('[data-step="hold"]')).toHaveAttribute("data-step-state", "now");
  await expect(doNow.locator('[data-step="problem"]')).toHaveAttribute("data-step-state", "next");
  await expect(doNow.locator('[data-step="missing"]')).toContainText("Promissory Note");
  await expect(page.locator("[data-hold-summary]")).toHaveCount(1);
  await expect(titleChips(page)).toHaveCount(0);
  let list = await openItems(page);
  await expect(list).toContainText("Things that need follow-up before this loan can move.");
  await expect(list.locator("[data-open-row]")).toHaveCount(2); // the PPSR problem and the Mortgage hold
  await expect(list.locator('[data-open-row][data-txn-code="NOTARY"]')).toHaveCount(0);
  expect(await list.locator("[data-open-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-open-group")))).toEqual(["hold", "problem"]);
  for (const row of await list.locator('[data-open-row="hold"]').all()) await expect(row.getByRole("button")).toHaveText(["Resume"]);
  for (const row of await list.locator('[data-open-row="problem"]').all()) await expect(row.getByRole("button")).toHaveText(["Open"]);
  await expect(page.locator("[data-open-banners]")).toHaveCount(0);
  await expect(list.locator('[data-open-row="hold"][data-txn-code="MORTGAGE"] [data-open-remarks]')).toHaveText("“LTO set the appointment for Monday”");
  await expect(page.locator("[data-txn=PPSR] [data-status-chip]").filter({ visible: true })).toHaveText("Problem");
  await expect(page.locator("[data-txn=MORTGAGE] [data-status-chip]").filter({ visible: true })).toHaveText("On hold");
  await shot(page, "check-docs-open-items");
  await noSideways(page);
  expect(await page.locator("main").innerText()).not.toMatch(/pending/i);

  // Open (problem): its details and actions.
  await list.locator('[data-open-row="problem"][data-txn-code="PPSR"]').getByRole("button", { name: "Open" }).click();
  const prob = page.getByRole("dialog", { name: "Problem: Entry of PPSR" });
  await expect(prob).toContainText(/LTO maintenance or system down · \d+ days?/);
  await expect(prob.getByRole("button", { name: "Go to Entry of PPSR" })).toBeVisible();
  await prob.getByRole("button", { name: "Close" }).click();

  // From Entry of PPSR, Notary's items are in Open items, grouped; Show paper opens Notary and highlights the paper.
  await page.goto("/loans/GD1652026901003?tab=todo&tx=PPSR");
  list = await openItems(page);
  expect(await list.locator("[data-open-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-open-group")))).toEqual(["missing", "hold", "problem"]);
  await expect(list.locator('[data-open-group="missing"] h3')).toHaveText("Waiting for papers");
  await expect(list.locator('[data-open-group="hold"] h3')).toHaveText("On hold");
  await expect(list.locator('[data-open-group="problem"] h3')).toHaveText("Problems");
  // The whole row is the button: badge, transaction, papers, then who and the date and time; no separate Show paper button.
  const missingRow = list.locator('[data-open-row="missing"]');
  await expect(missingRow.getByRole("button")).toHaveCount(1);
  await expect(missingRow.getByRole("button")).toHaveAttribute("data-open-action", "Show paper");
  await expect(missingRow.locator("[data-open-who]")).toHaveText(/^Asked by Test Loan Associate · .+ PHT · from Borrower$/);
  await expect(list.locator('[data-open-row="missing"]')).toContainText(/Asked by Test Loan Associate · .+ · from Borrower/);
  await expect(list.locator('[data-open-row][data-txn-code="PPSR"]')).toHaveCount(0);
  await list.locator('[data-open-row="missing"]').getByRole("button", { name: "Show paper" }).click();
  await expect(page).toHaveURL(/tx=NOTARY/);
  await expect(papers.locator('[data-flash="true"]')).toHaveCount(1);

  // Resume from the card: the Resume pop-up (remarks required); the problem becomes the step to do now.
  await doNow.getByRole("button", { name: "Resume" }).click();
  const resume = page.getByRole("dialog", { name: "Resume the work" });
  await expect(resume.getByRole("button", { name: "Resume" })).toBeDisabled();
  await resume.getByLabel("Resume remarks").fill("Borrower called back");
  await resume.getByRole("button", { name: "Resume" }).click();
  await expect(toast(page)).toHaveText(/Notary resumed/);
  await expect(doNow.locator('[data-step="hold"]')).toHaveCount(0);
  await expect(doNow.locator('[data-step="problem"]')).toHaveAttribute("data-step-state", "now");

  // Pressing a row selects its transaction.
  list = await openItems(page);
  await list.locator('[data-open-row="problem"][data-txn-code="PPSR"]').getByText("LTO maintenance or system down").click();
  await expect(page).toHaveURL(/tx=PPSR/);

  // Ticking the requested paper closes the missing paper: tag and row go.
  await page.goto("/loans/GD1652026901003?tab=todo&tx=NOTARY");
  await page.getByRole("group", { name: "Notary papers" }).getByLabel("Promissory Note").check();
  await expect(page.getByRole("group", { name: "Notary papers" }).locator("[data-requested]")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('[data-do-now] [data-step="missing"]')).toHaveCount(0);
  await expect(page.locator('[data-open-row="missing"]')).toHaveCount(0);
  await noSideways(page);

  // The Journey (Story): plain words, no "Pending".
  await page.goto("/loans/GD1652026901003?tab=journey");
  await expect(page.locator("[data-journey]")).toContainText("asked for a missing paper for Notary: Promissory Note");
  expect(await page.locator("main").innerText()).not.toMatch(/pending/i);
});

test("Put on hold: pressed with no reason, it says \"Pick a reason\" and saves nothing", async ({ page }) => {
  await signIn(page, "la");
  await openPn3(page);
  await page.goto("/loans/GD1652026901003?tab=todo&tx=NOTARY");
  await page.getByRole("button", { name: "Put on hold" }).click();
  const sheet = page.getByRole("dialog", { name: "Put on hold" });
  await sheet.getByRole("button", { name: "Put on hold" }).evaluate((b) => { (b as HTMLButtonElement).disabled = false; });
  await sheet.getByRole("button", { name: "Put on hold" }).click();
  await expect(sheet.getByText("Pick a reason", { exact: true }).last()).toBeVisible();
  expect(await db.hold.count()).toBe(0);
});

test("Ask for missing paper: pressed with no paper, it says \"Pick at least one paper\"; the To do link opens it", async ({ page }) => {
  await signIn(page, "la");
  await openPn3(page);
  // "Something wrong?" on the To do tab: Missing paper goes to the pop-up on Check documents.
  await page.goto("/loans/GD1652026901003?tab=todo");
  await page.getByRole("button", { name: "Report a problem" }).click();
  await page.getByRole("link", { name: "Choose the papers" }).click();
  await expect(page).toHaveURL(/ask=missing/);
  const ask = page.getByRole("dialog", { name: "Ask for missing paper" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Ask for the paper" }).evaluate((b) => { (b as HTMLButtonElement).disabled = false; });
  await ask.getByRole("button", { name: "Ask for the paper" }).click();
  await expect(ask.getByText("Pick at least one paper.")).toBeVisible();
  expect(await db.loanException.count({ where: { type: "LEGAL_DOCS_COMPLETION" } })).toBe(0);
});
