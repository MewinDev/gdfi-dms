import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, visibleSearchBox, watchConsole } from "./helpers";

/**
 * The real PN format, branch codes and areas from MyLoans, the Branch review and branch access.
 * Screenshots at 1440 and 390 px: docs/screenshots/pn-branches/ (820 runs the checks without them).
 */
const DIR = "docs/screenshots/pn-branches";
const shoots = (page: Page) => [1440, 390].includes(page.viewportSize()?.width ?? 0);
async function shot(page: Page, name: string, fullPage = false) {
  if (!shoots(page)) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${DIR}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage });
}

test.beforeEach(async () => {
  await resetLoans();
  await db.setting.upsert({ where: { key: "pn.format" }, create: { key: "pn.format", value: { enabled: true, prefix: "GD", branchDigits: 3, yearDigits: 4, system: "9", runningDigits: 5 } }, update: { value: { enabled: true, prefix: "GD", branchDigits: 3, yearDigits: 4, system: "9", runningDigits: 5 } } });
  await db.setting.upsert({ where: { key: "myloans.mockOverrides" }, create: { key: "myloans.mockOverrides", value: {} }, update: { value: {} } });
});

test("PN format setting: the parts, the pattern and Try a PN", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/settings?open=system");
  const form = page.locator("[data-pn-format]");
  await expect(form.locator("[data-pn-pattern]")).toContainText("GD ### #### 9 #####");
  await expect(form.locator("[data-pn-pattern]")).toContainText("GD1012026900001");
  const box = form.getByLabel("Try a PN");
  await box.fill("gd 101-2026-9-00001");
  await expect(form.locator("[data-pn-try-result]")).toContainText("Looks right: GD1012026900001");
  await box.fill("GD1012027900001");
  await expect(form.locator("[data-pn-try-result]")).toContainText("The year is in the future (2027).");
  await form.scrollIntoViewIfNeeded();
  await shot(page, "pn-format-setting");
});

test("Find loan: a wrong PN says which part is wrong and never asks MyLoans; a pasted PN works", async ({ page }) => {
  await signIn(page, "la");
  await page.goto("/loans?find=1");
  await visibleSearchBox(page).fill("GD10120269010");
  await visibleSearchBox(page).press("Enter");
  await expect(page).toHaveURL(/\/search\?q=/);
  const err = page.locator("[data-pn-error]");
  await expect(err).toContainText("This does not look like a PN. Example: GD1012026900001");
  await expect(err.locator("[data-pn-part]")).toHaveText("The running number must be 5 digits (this one has 3).");
  await shot(page, "find-loan-wrong-pn");
  await page.goto(`/search?q=${encodeURIComponent("gd 101-2026-9-01001")}`);
  await expect(page.locator("[data-find-preview]").getByText("GD1012026901001")).toBeVisible(); // the result, not a (folded) sample chip
  await expect(page.locator("[data-pn-error]")).toHaveCount(0);
});

test("Loan File: Opened at Antipolo, now at Angono after a MyLoans branch change (names, no codes)", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/search?q=GD1012026901001");
  await page.getByRole("button", { name: /Open loan file/ }).click();
  await expect(page).toHaveURL(/\/loans\/GD1012026901001/);
  await expect(page.locator("[data-opened-at]")).toHaveText("Opened at Antipolo");
  // MyLoans now says Angono (165); Admin applies it in the MyLoans review.
  const over = { "GD1012026901001": { branchName: "Angono", branchCode: "165", changedAt: new Date().toISOString() } };
  await db.setting.upsert({ where: { key: "myloans.mockOverrides" }, create: { key: "myloans.mockOverrides", value: over }, update: { value: over } });
  await page.context().clearCookies();
  await signIn(page, "admin");
  await page.goto("/loans/GD1012026901001");
  // Refresh from MyLoans asks MyLoans afresh. A refresh on open may reuse the answer the server kept for
  // up to a minute (lib/myloans/client.ts), and an earlier spec in the same server may have just asked
  // for this PN, before the branch change was set.
  await page.getByRole("button", { name: "Refresh from MyLoans" }).click();
  await page.locator("[data-source-entry]").getByRole("button", { name: "Review" }).click();
  const sheet = page.locator('[data-source-review="MATERIAL"]');
  await expect(sheet.locator("[data-branch-move]")).toContainText("Branch: Antipolo → Angono");
  await shot(page, "branch-change-review");
  await sheet.getByLabel("Note (required)").fill("MyLoans moved the account to Angono.");
  await sheet.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.locator("[data-opened-at]")).toHaveText("Opened at Antipolo, now at Angono");
  await shot(page, "loan-opened-at-now-at");
  clean();
});

// ---------------------------------------------------------------------------------------------------
// Settings, Branches; Import from MyLoans; the Branch review; Users, Branch access.
// ---------------------------------------------------------------------------------------------------

/** Clean-up: the review items, runs and sample changes these tests make (the test database only). */
async function resetBranchSamples() {
  await db.branchReview.deleteMany({ where: { source: { not: "seed" } } });
  await db.setting.upsert({ where: { key: "myloans.mockBranches" }, create: { key: "myloans.mockBranches", value: { overrides: {}, extra: [] } }, update: { value: { overrides: {}, extra: [] } } });
  await db.setting.upsert({ where: { key: "branches.sync" }, create: { key: "branches.sync", value: { time: "02:00", paused: false, lastRunDate: null, lastSuccessAt: null, lastFullAt: null, lastLookupAt: null } }, update: { value: { time: "02:00", paused: false, lastRunDate: null, lastSuccessAt: null, lastFullAt: null, lastLookupAt: null } } });
  await db.user.deleteMany({ where: { email: { startsWith: "zz.pnb." } } });
  await db.branch.deleteMany({ where: { code: { in: ["999", "721"] } } });
}

test("Settings, Branches: the list, and an inactive branch that still has a user and an open loan", async ({ page }) => {
  await resetBranchSamples();
  const alicia = await db.branch.findUniqueOrThrow({ where: { code: "718" } });
  const la = await db.role.findUniqueOrThrow({ where: { key: "LA" } });
  const u = await db.user.create({ data: { email: "zz.pnb.alicia@gdfi.ph", name: "Zz Alicia LA", roleId: la.id, isTestUser: true, homeBranchId: alicia.id } });
  await db.userAccessGrant.create({ data: { userId: u.id, kind: "BRANCH", branchId: alicia.id } });
  await db.userBranch.create({ data: { userId: u.id, branchId: alicia.id } });
  try {
    await signIn(page, "admin");
    await page.goto("/admin/settings?open=branches");
    const list = page.locator("[data-branches-list]");
    await expect(list).toContainText("Antipolo");
    await expect(list).toContainText("101");
    await shot(page, "settings-branches");
    await page.goto("/admin/settings?open=branches&show=inactive");
    await expect(page.locator("[data-inactive-warning]").first()).toContainText("1 active user");
    await shot(page, "inactive-branch-warning");
  } finally {
    await db.user.delete({ where: { id: u.id } });
  }
});

test("Import from MyLoans: the preview (test-looking rows first, counts per Division and Area)", async ({ page }) => {
  await resetBranchSamples();
  const head = "division_id,division,area_id,area,branch_id,code,contact,name,address";
  const rows = [
    "1,Branch Division,1,LUZON 1 (NGMA + RIZAL),5,101,77436381,Antipolo,\"Unit 6 FLJ Building, P. Oliveros St., Antipolo City\"",
    "1,Branch Division,1,LUZON 1 (NGMA + RIZAL),4,165,36752849,Angono,",
    "1,Branch Division,1,LUZON 1 (NGMA + RIZAL),3,174,58170325,Amang Rodriguez - Pasig,",
    "1,Branch Division,1,LUZON 1 (NGMA + RIZAL),209,999,,Test Branch,",
    "1,Branch Division,3,LUZON 2 SOL,10,721,,Bacoor(DONT USE),\"Unit 9 2F Saed Bldg., Molino Road, Bacoor City\"",
  ];
  await signIn(page, "admin");
  await page.goto("/admin/settings?open=branches&step=myloans");
  await page.getByLabel("MyLoans branch file (.csv, .tsv or .txt)").setInputFiles({ name: "myloans-branches.csv", mimeType: "text/csv", buffer: Buffer.from(`${head}\n${rows.join("\n")}\n`) });
  await page.getByRole("button", { name: "Check file" }).click();
  const preview = page.locator("[data-import-preview]");
  await expect(preview).toBeVisible();
  await expect(preview.locator("[data-preview-counts]")).toBeVisible();
  await expect(preview.locator("[data-test-note]").first()).toContainText("Looks like a test or unused branch");
  await expect(preview).toContainText("Amang Rodriguez - Pasig");
  await expect(preview.locator("[data-preview-missing]").first()).toBeVisible();
  await preview.locator("[data-preview-counts]").scrollIntoViewIfNeeded();
  await shot(page, "import-from-myloans-preview");
  await preview.locator("[data-test-note]").first().scrollIntoViewIfNeeded();
  await shot(page, "import-from-myloans-suggestions");
});

test("Branch review: a rename and a code change from MyLoans, Accept shows the impact first", async ({ page }) => {
  await resetBranchSamples();
  const over = { overrides: { "3": { name: "Amang Rodriguez - Pasig", updatedAt: new Date().toISOString() }, "398": { code: "710", updatedAt: new Date().toISOString() } }, extra: [] };
  await db.setting.update({ where: { key: "myloans.mockBranches" }, data: { value: over } });
  try {
    await signIn(page, "admin");
    await page.goto("/admin/settings?open=branches&step=sync");
    const started = new Date();
    await page.getByRole("button", { name: "Branches from MyLoans" }).click();
    await expect.poll(async () => db.branchSyncRun.count({ where: { trigger: "api", ok: true, at: { gte: started } } }), { timeout: 30_000 }).toBe(1);
    await expect(page.locator("[data-branch-runs]")).toContainText("MyLoans API");
    await page.goto("/admin/settings?open=branches&step=review");
    const review = page.locator("[data-branch-review]");
    await expect(review).toContainText("Amang Rodriguez - Pasig");
    await expect(review).toContainText("710");
    // The Branch review page keeps the codes: the Code changed item still shows the old and the new code.
    await expect(review).toContainText("709");
    await shot(page, "branch-review");
    // Home: the Branch review card shows the branch name only (no brackets, no code); the pill stays.
    await page.goto("/dashboard");
    const card = page.locator("[data-branch-review-card]");
    const names = card.locator("[data-review-name]");
    await expect(names.filter({ hasText: "Amang Rodriguez - Pasig" })).toHaveCount(1);
    await expect(names.filter({ hasText: /^Alicia$/ })).toHaveCount(1);
    for (const t of await names.allInnerTexts()) expect(t).not.toMatch(/[()0-9]/);
    await expect(card).toContainText("Code changed");
    await expect(card).toContainText("Renamed");
    await card.scrollIntoViewIfNeeded();
    await shot(page, "dashboard-branch-review");
    await page.goto("/admin/settings?open=branches&step=review");
    await review.getByRole("button", { name: /^Accept Renamed/ }).click();
    const dlg = page.getByRole("alertdialog");
    await expect(dlg.locator("[data-review-impact]")).toBeVisible();
    await shot(page, "branch-review-impact");
    await dlg.getByRole("button", { name: "Not now" }).click();
  } finally {
    await resetBranchSamples();
  }
});

test("Users, Branch access: the tree collapsed and expanded, an exception and the summary", async ({ page }) => {
  await signIn(page, "admin");
  const la = await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  await page.goto(`/admin/users?open=user&edit=${la.id}`);
  const field = page.locator("[data-branch-access]");
  await expect(field.locator("[data-access-tree]")).toBeVisible();
  await field.scrollIntoViewIfNeeded();
  await shot(page, "access-tree-collapsed");
  // Tick the whole Area LUZON 1 (Branch Division), then untick one branch: an exception.
  await field.getByRole("button", { name: /Branch Division/ }).first().click();
  const node = field.locator('[data-node="Branch Division|LUZON 1 (NGMA + RIZAL)"]');
  await node.getByRole("button", { name: /LUZON 1/ }).first().click();
  await node.getByRole("checkbox", { name: "LUZON 1 (NGMA + RIZAL) (Branch Division): all branches" }).click();
  await shot(page, "access-tree-expanded");
  await node.locator('[data-branch="174"]').getByRole("checkbox").uncheck();
  await expect(field.locator("[data-exception-note]").first()).toContainText("except 1 branch");
  await expect(field.locator("[data-access-summary]")).toContainText("1 area");
  await shot(page, "access-exception-summary");
});
