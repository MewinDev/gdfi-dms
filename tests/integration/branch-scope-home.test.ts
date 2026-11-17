// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { advanceScope, type CurrentUser } from "@/lib/auth/current-user";
import { setUserBranches } from "@/lib/services/access";
import { sourceChangesToDo } from "@/components/loan/source-changes-card";
import { borrowerToDo, branchesWithoutApprover, deciderIds } from "@/lib/services/borrower-review";
import { listLoans } from "@/lib/services/queries";
import { financeIds } from "@/lib/services/funds";
import { kindUsage } from "@/lib/services/expense-kinds";
import { supervisorUserIds } from "@/lib/notify";
import { reviewFor } from "@/lib/services/source-review";
import { setupWarnings } from "@/components/home/setup-warnings";
import { asUser } from "./helpers";

/**
 * D-019 per card (review of piece 2, 17 Nov 2026): an Angono-only LA Supervisor/Head and an Angono-only
 * Finance see only Angono data on every Home card, count, list and notification, and a ?branch= filter
 * cannot widen their scope. Test database only (fake borrowers).
 */
const P = "GD9992099770"; // fake PNs GD999209977001...
const EMAIL = (k: string) => `zz.scope.${k}@gdfi.ph`;
let angono: string, antipolo: string;
let sup: CurrentUser, fin: CurrentUser, admin: CurrentUser, superadmin: CurrentUser;

async function makeUser(key: string, roleKey: string, branchIds: string[], extra: Record<string, unknown> = {}) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const u = await prisma.user.create({ data: { email: EMAIL(key), name: `Zz Scope ${key}`, roleId: role.id, isTestUser: true, ...extra } });
  await setUserBranches(u.id, branchIds);
  return asUser(u.email);
}
async function loan(n: string, branchId: string, borrower: string) {
  const opener = await prisma.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  const mortgage = await prisma.transactionType.findUniqueOrThrow({ where: { code: "MORTGAGE" } });
  return prisma.loan.create({
    data: {
      pn: `${P}${n}`, borrowerName: borrower, branchId, loanType: "New", productName: "Auto Financing", totalReleasedAmount: 400000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: opener.id,
      classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "scope test", stage: "For checklist", transactions: { create: { typeId: mortgage.id } },
    },
    include: { transactions: true },
  });
}
const change = (loanId: string, category: "MATERIAL" | "BORROWER") =>
  prisma.sourceChange.create({ data: { loanId, category, changes: [{ field: "address", label: "Address", kind: "borrower", was: null, now: "x" }], proposed: { sentences: [], affected: [], needsPicks: false }, hash: `h-${loanId}-${category}` } });

async function clean() {
  await prisma.cashAdvance.deleteMany({ where: { number: { startsWith: "CA-2099-97" } } });
  await prisma.loan.deleteMany({ where: { pn: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz.scope." } } });
}

let angonoLoan: Awaited<ReturnType<typeof loan>>, antipoloLoan: Awaited<ReturnType<typeof loan>>;
beforeAll(async () => {
  await clean();
  [angono, antipolo] = await Promise.all(["165", "101"].map(async (code) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).id));
  sup = await makeUser("sup", "SUP", [angono]);
  fin = await makeUser("fin", "FIN", [angono], { allBranches: false, handlesCa: true, handlesFt: true });
  admin = await asUser("test.admin@gdfi.ph");
  superadmin = await asUser("test.superadmin@gdfi.ph");
  angonoLoan = await loan("01", angono, "Ana Angono");
  antipoloLoan = await loan("02", antipolo, "Ben Antipolo");
  for (const l of [angonoLoan, antipoloLoan]) { await change(l.id, "MATERIAL"); await change(l.id, "BORROWER"); }
  const dp = await prisma.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  // Both requests come from an Angono processor; one has a line for the Antipolo loan.
  const base = { requestedById: dp.id, branchId: angono, requestedCents: 100_000 };
  await prisma.cashAdvance.create({ data: { ...base, number: "CA-2099-9701", lines: { create: [{ transactionId: angonoLoan.transactions[0].id, kind: "TRANSPORT", requestedCents: 100_000 }] } } });
  await prisma.cashAdvance.create({ data: { ...base, number: "CA-2099-9702", lines: { create: [{ transactionId: antipoloLoan.transactions[0].id, kind: "TRANSPORT", requestedCents: 100_000 }] } } });
});
afterAll(clean);

describe("an Angono-only LA Supervisor/Head and Finance see only Angono", () => {
  it("Home: MyLoans changes card", async () => {
    const mine = await sourceChangesToDo(sup);
    expect(mine.items.map((i) => i.loan.pn)).toContain(angonoLoan.pn);
    expect(mine.items.map((i) => i.loan.pn)).not.toContain(antipoloLoan.pn);
    // All branches (Admin) sees both; borrower corrections are not on this card.
    const all = await sourceChangesToDo(admin);
    expect(all.items.every((i) => i.category !== "BORROWER")).toBe(true);
  });

  it("Home: Corrections to review", async () => {
    const pns = (await borrowerToDo(sup, 50)).items.map((i) => i.pn);
    expect(pns).toContain(angonoLoan.pn);
    expect(pns).not.toContain(antipoloLoan.pn);
  });

  it("Loans list and its counts: ?branch= of another branch shows nothing (it narrows, never widens)", async () => {
    const pns = (await listLoans(sup, { tab: "all", q: P })).map((r) => r.pn);
    expect(pns).toEqual([angonoLoan.pn]);
    expect(await listLoans(sup, { tab: "all", branch: antipolo, q: P })).toEqual([]);
    expect((await listLoans(admin, { tab: "all", branch: antipolo, q: P })).map((r) => r.pn)).toEqual([antipoloLoan.pn]);
  });

  it("the review card on a loan file: out of scope is not there", async () => {
    expect(await reviewFor(sup, antipoloLoan.id)).toBeNull();
    expect(await reviewFor(sup, angonoLoan.id)).not.toBeNull();
  });

  it("Funds lists and Finance Home counts: a request with a line for another branch's loan is not listed", async () => {
    const numbers = (await prisma.cashAdvance.findMany({ where: { ...advanceScope(fin), number: { startsWith: "CA-2099-97" } }, select: { number: true } })).map((a) => a.number);
    expect(numbers).toEqual(["CA-2099-9701"]);
    expect(advanceScope(admin)).toEqual({});
  });

  it("Settings, Expense kinds: the usage count is of requests in the person's branches", async () => {
    const before = (await kindUsage(undefined, advanceScope(admin))).get("TRANSPORT")?.lines ?? 0;
    const scoped = (await kindUsage(undefined, advanceScope(fin))).get("TRANSPORT")?.lines ?? 0;
    expect(before - scoped).toBeGreaterThanOrEqual(1); // the Antipolo line is not counted for Angono
  });

  it("notifications: Finance of Angono is not told about a request that reaches Antipolo; problems go to supervisors of the loan's branch", async () => {
    expect(await financeIds(prisma, { number: "CA-2099-9701" }, "approve")).toContain(fin.id);
    expect(await financeIds(prisma, { number: "CA-2099-9702" }, "approve")).not.toContain(fin.id);
    expect(await supervisorUserIds(prisma, antipolo)).not.toContain(sup.id);
  });

  it("approvers: everyone with the tick whose access has the branch (All branches covers every branch); no fallback", async () => {
    const ids = await deciderIds(prisma, angono);
    expect(ids).toEqual(expect.arrayContaining([sup.id, admin.id]));
    expect(await deciderIds(prisma, antipolo)).not.toContain(sup.id);
  });

  it("Superadmin Home: branches with no approver, and the one-Superadmin warning", async () => {
    const alaminos = (await prisma.branch.findUniqueOrThrow({ where: { code: "390" } })).id;
    expect((await branchesWithoutApprover()).map((b) => b.id)).toContain(alaminos);
    expect((await setupWarnings()).join(" ")).toMatch(/no approver assigned/);
    expect(superadmin.permissions.has("roles:manage")).toBe(true);
  });
});
