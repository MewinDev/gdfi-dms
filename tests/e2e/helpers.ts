import { expect, type Page } from "@playwright/test";

export async function signIn(page: Page, who: "la" | "admin") {
  await page.goto("/login");
  await page.getByRole("button", { name: who === "admin" ? "Continue as Admin" : "Continue as Loan Associate" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
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
