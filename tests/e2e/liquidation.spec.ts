import { expect, test } from "@playwright/test";
import { db } from "./db";
import { signIn } from "./helpers";

/**
 * Piece 5 (D-044) as Finance sees it: one plain line per advance on Funds. Waiting for the LTO pickup (no date),
 * due by fallback, and the late record on History. Fake request numbers (CA-2099-59xx).
 */
const N = (k: string) => `CA-2099-59${k}`;
const clean = () => db.cashAdvance.deleteMany({ where: { number: { startsWith: "CA-2099-59" } } });

test.beforeEach(async () => {
  await clean();
  const [dp, branch] = await Promise.all([db.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } }), db.branch.findUniqueOrThrow({ where: { code: "165" } })]);
  const base = { requestedById: dp.id, branchId: branch.id, requestedCents: 100_000, approvedCents: 100_000, approvedAt: new Date(), releasedCents: 100_000, releasedAt: new Date(), fundsTypeId: "fundstype_ca", lines: { create: [{ kind: "TRANSPORT", requestedCents: 100_000, approvedCents: 100_000, releasedCents: 100_000, note: "Courier" }] } };
  await db.cashAdvance.create({ data: { ...base, number: N("01"), status: "RELEASED", liquidationNote: "1 of 2 left" } });
  await db.cashAdvance.create({ data: { ...base, number: N("02"), status: "RELEASED", liquidationDueAt: new Date("2099-03-05T23:59:00+08:00"), liquidationBasis: "FALLBACK" } });
  await db.cashAdvance.create({ data: { ...base, number: N("03"), status: "CLOSED", closedAt: new Date(), liquidationDueAt: new Date("2026-11-27T23:59:00+08:00"), liquidatedAt: new Date("2026-11-30T10:00:00+08:00"), daysLate: 2 } });
});
test.afterAll(clean);

test("Funds shows one plain line: waiting for the LTO pickup, due by fallback, and how late it was liquidated", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/funds?tab=outstanding");
  await expect(page.locator(`[data-advance="${N("01")}"] [data-liquidation-line]`).first()).toHaveText("Due 2 working days after the LTO pickup (1 of 2 left)");
  await expect(page.locator(`[data-advance="${N("02")}"] [data-liquidation-line]`).first()).toHaveText(/^LTO not done\. Liquidation due by fallback: /);
  await page.goto("/funds?tab=history");
  await expect(page.locator(`[data-advance="${N("03")}"] [data-days-late]`).first()).toHaveText("Liquidated 2 working days late");
});
