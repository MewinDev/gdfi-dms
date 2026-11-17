import { expect, test, type Page } from "@playwright/test";
import { db } from "./db";
import { signIn, docShot } from "./helpers";

/**
 * Audit, File access log (D-039): the tabs, the filters, and Download CSV, which is itself logged.
 * The log is append-only, so this spec only adds rows (with a run marker), never removes them.
 * Screenshots at 1440 and 390 px: docs/screenshots/file-access-log/.
 */
const DIR = "docs/screenshots/file-access-log";
const shoots = (page: Page) => [1440, 390].includes(page.viewportSize()?.width ?? 0);
async function shot(page: Page, name: string) {
  if (!shoots(page)) return;
  await page.evaluate(() => document.fonts.ready);
  await docShot(page, { path: `${DIR}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

test("Admin filters the file access log and downloads it; the export is logged", async ({ page }) => {
  const run = `e2e${Date.now().toString(36)}`;
  const admin = await db.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  const branch = await db.branch.findUniqueOrThrow({ where: { code: "101" } });
  // The log is append-only: pick a test PN that has no rows yet (earlier runs keep theirs).
  const used = new Set((await db.fileAccessLog.findMany({ where: { pn: { startsWith: "GD9992099969" } }, select: { pn: true }, distinct: ["pn"] })).map((r) => r.pn));
  const free = Array.from({ length: 100 }, (_, i) => "GD9992099969" + String(i).padStart(2, "0")).filter((x) => !used.has(x));
  const pn = free[Date.now() % free.length] ?? "GD999209996999";
  await db.fileAccessLog.createMany({ data: [
    { userId: admin.id, entityType: "RECEIPT", entityId: `${run}-1`, pn, branchId: branch.id, fileKey: "k1", fileName: `${run}-receipt.jpg`, action: "VIEW" },
    { userId: admin.id, entityType: "LTO_PROOF", entityId: `${run}-2`, pn, branchId: branch.id, fileKey: "k2", fileName: `${run}-lto.pdf`, action: "DOWNLOAD" },
  ] });

  await signIn(page, "admin");
  await page.goto("/admin/audit");
  const tabs = page.getByRole("navigation", { name: "Audit pages" });
  await expect(tabs.getByRole("link", { name: "Audit log" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "File access log" }).click();
  await expect(page.getByRole("heading", { name: "File Access Log" })).toBeVisible();

  await page.getByLabel("PN #").fill(pn);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.locator("[data-file-log-row]")).toHaveCount(2);
  await page.getByLabel("File type").selectOption({ label: "LTO proof" });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.locator("[data-file-log-row]")).toHaveCount(1);
  await expect(page.locator("[data-file-log-row]").first()).toContainText(`${run}-lto.pdf`);
  await expect(page.locator("[data-file-log-row]").first()).toContainText("Downloaded");
  await shot(page, "filtered");

  const before = await db.fileAccessLog.count({ where: { userId: admin.id, action: "EXPORT" } });
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-file-log-export]").click()]);
  expect(download.suggestedFilename()).toMatch(/^file-access-log-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(csv).toContain(`${run}-lto.pdf`);
  expect(csv).not.toContain(`${run}-receipt.jpg`); // the type filter applies to the export
  await expect.poll(() => db.fileAccessLog.count({ where: { userId: admin.id, action: "EXPORT" } })).toBe(before + 1);

  // The export shows in the log itself (Admin has All branches).
  await page.goto("/admin/audit/files?type=FILE_ACCESS_LOG");
  await expect(page.locator("[data-file-log-row]").first()).toContainText("Exported");

  // Nothing matches: Download CSV is off, with the reason.
  await page.goto(`/admin/audit/files?pn=${run}-nothing`);
  await expect(page.getByRole("button", { name: "Download CSV" })).toBeDisabled();
  await expect(page.locator("[data-file-log-total]")).toContainText("nothing to download");
  await shot(page, "nothing-matches");
});
