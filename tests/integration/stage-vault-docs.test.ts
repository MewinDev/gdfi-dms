/**
 * recomputeStage and the vault stages (lib/services/stage.ts). Regression: the papers filter was written
 * as NOT(check.missingState = MISSING), which SQL turns into NULL for every normal paper (missingState
 * is NULL), so no paper was counted and a loan never left "For Vault Transmittal". A paper marked Missing
 * still must not hold the file at the vault gate. LOCAL test database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { recomputeStage } from "@/lib/services/stage";
import { asUser, cleanLoans } from "./helpers";

const PN = "GD1012026907901";
let loanId = "";
let checks: string[] = [];
let docs: string[] = [];

beforeAll(async () => {
  await cleanLoans();
  const admin = await asUser("test.admin@gdfi.ph");
  const branch = await prisma.branch.findUniqueOrThrow({ where: { code: "101" } });
  const notary = await prisma.transactionType.findUniqueOrThrow({ where: { code: "NOTARY" } });
  const rule = await prisma.checklistRule.findFirstOrThrow({ where: { transactionTypeId: notary.id } });
  const now = new Date();
  const loan = await prisma.loan.create({
    data: {
      pn: PN, cin: null, cif: null, borrowerName: "Vault Stage Sample", branchId: branch.id, loanType: "New", productName: "Auto Financing",
      totalReleasedAmount: 300_000, releasedAt: now, sourceStatus: "RELEASED", retrievedAt: now, openedById: admin.id,
      classification: "FINANCING", mortgageResult: "NOT_MORTGAGE", ruleFired: "test", stage: "For Vault Transmittal",
    },
  });
  loanId = loan.id;
  const t = await prisma.loanTransaction.create({ data: { loanId, typeId: notary.id, status: "COMPLETED", fundsNeeded: "NO" } });
  // Two papers with a checklist row (missingState NULL, as every normal paper) and one without.
  const c1 = await prisma.checklistCheck.create({ data: { transactionId: t.id, ruleId: rule.id } });
  checks = [c1.id];
  const mk = (i: number, checkId: string | null) =>
    prisma.documentItem.create({ data: { loanId, transactionId: t.id, checkId, documentId: `${PN}-T-0${i}`, docTypeCode: "OTHERS", label: `Paper ${i}`, stage: "AT_BRANCH" } });
  docs = [(await mk(1, c1.id)).id, (await mk(2, null)).id];
});

afterAll(async () => {
  await cleanLoans();
  await prisma.$disconnect();
});

const setDocs = (stage: "AT_BRANCH" | "IN_TRANSIT" | "IN_SAFEKEEPING", ids = docs) => prisma.documentItem.updateMany({ where: { id: { in: ids } }, data: { stage } });
const stage = () => prisma.$transaction((tx) => recomputeStage(tx, loanId));

describe("recomputeStage: vault stages", () => {
  it("papers at the branch: For Vault Transmittal", async () => {
    await setDocs("AT_BRANCH");
    expect(await stage()).toBe("For Vault Transmittal");
  });

  it("papers in transit (missingState NULL): In transit to Vault", async () => {
    await setDocs("IN_TRANSIT");
    expect(await stage()).toBe("In transit to Vault");
  });

  it("every paper in safekeeping: In Safekeeping", async () => {
    await setDocs("IN_SAFEKEEPING");
    expect(await stage()).toBe("In Safekeeping");
  });

  it("a paper marked Missing (still at the branch) does not hold the file at the vault gate", async () => {
    await prisma.checklistCheck.update({ where: { id: checks[0] }, data: { missingState: "MISSING" } });
    await setDocs("AT_BRANCH", [docs[0]]);
    await setDocs("IN_SAFEKEEPING", [docs[1]]);
    expect(await stage()).toBe("In Safekeeping");
  });
});
