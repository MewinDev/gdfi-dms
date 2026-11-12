/**
 * Stage map (display only): a loan in each live stage, read the way the Loans table and My loans read it
 * (listLoans, then cardFor): the Stage column text, the Next step text and its "Waiting for: …" tooltip.
 * The stages are stored directly (nothing moves a loan here). LOCAL test database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { listLoans } from "@/lib/services/queries";
import { cardFor } from "@/lib/ui/loan-cards";
import { listStage, ownerTooltip, stepperOf } from "@/lib/workflow/stage-map";
import { STAGES } from "@/lib/workflow/stage";
import { asUser, cleanLoans } from "./helpers";

let admin: CurrentUser;
const PN = (i: number) => `GD1012026907${String(i).padStart(3, "0")}`;

/** Stage column, Next step, tooltip, stepper step (null: no step), as the business's table says. */
const WANT: Record<string, [string, string, string | undefined, number | null]> = {
  Opened: ["Check documents", "System sets up the transactions", undefined, 3],
  "For checklist": ["Check documents", "Check documents, then assign to DP", "Waiting for: Loan Associate", 3],
  "No DP assignment required": ["Check documents (LA only)", "Complete the LA-only transactions", "Waiting for: Loan Associate", 3],
  "Assigned to DP": ["DP Assigning", "DP accepts the assignment", "Waiting for: Document Processor / Collateral & Mortgage", 4],
  "In process": ["LTO Processing", "DP processes the transactions", "Waiting for: Document Processor / Collateral & Mortgage", 4],
  "Awaiting LA acceptance": ["Forwarding to LA branch", "LA accepts the package", "Waiting for: Loan Associate (receiving branch)", 5],
  "For Vault Transmittal": ["For transmittal", "Create the transmittal", "Waiting for: Loan Associate", 6],
  "In transit to Vault": ["Receiving", "Collateral receives by scan", "Waiting for: Collateral", 6],
  "In Safekeeping": ["In safekeeping", "Kept in the vault until the loan is fully paid", "Waiting for: Collateral", 9],
  Closed: ["Closed", "Records archives the file", "Waiting for: Records", 10],
  "Cancelled in MyLoans": ["Cancelled in MyLoans", "No further steps", undefined, null],
  Archived: ["Archived", "Kept until the retention period ends", undefined, null],
  Disposed: ["Disposed", "No further steps", undefined, null],
};

beforeAll(async () => {
  await cleanLoans();
  admin = await asUser("test.admin@gdfi.ph");
  const branch = await prisma.branch.findUniqueOrThrow({ where: { code: "101" } });
  const now = new Date();
  for (const [i, stage] of STAGES.entries()) {
    await prisma.loan.create({
      data: {
        pn: PN(i), cin: null, cif: null, borrowerName: `Stage ${i}`, branchId: branch.id, loanType: "New", productName: "Auto Financing",
        totalReleasedAmount: 300_000, releasedAt: now, sourceStatus: "RELEASED", retrievedAt: now, openedById: admin.id,
        classification: "FINANCING", mortgageResult: "MORTGAGE", ruleFired: "test", stage,
        closedAt: ["Closed", "Archived", "Disposed"].includes(stage) ? now : null,
        cancelledAt: stage === "Cancelled in MyLoans" ? now : null,
        archivedAt: ["Archived", "Disposed"].includes(stage) ? now : null,
        disposedAt: stage === "Disposed" ? now : null,
      },
    });
  }
});
afterAll(async () => {
  await cleanLoans();
  await prisma.$disconnect();
});

describe("stage map on the lists", () => {
  it("every live stage: the Stage column, the Next step and its tooltip (Loans table and My loans)", async () => {
    const rows = [...(await listLoans(admin, { tab: "all" })), ...(await listLoans(admin, { tab: "archived" }))].filter((r) => r.pn.startsWith("GD1012026907"));
    expect(rows.map((r) => r.stage).sort()).toEqual([...STAGES].sort());
    const holidays = new Set<string>();
    for (const r of rows) {
      const [label, next, tip, step] = WANT[r.stage];
      // Loans table: Stage column, Next step column and its title.
      expect(listStage(r.stage).label, r.stage).toBe(label);
      expect(r.nextStep.label, r.stage).toBe(next);
      expect(ownerTooltip(r.nextStep.owner), r.stage).toBe(tip);
      // My loans: the Next step column (no open problem on these loans); Home: the stage's name.
      const c = cardFor(r, holidays);
      expect(c.nextText, r.stage).toBe(next);
      expect(c.nextTip, r.stage).toBe(tip);
      expect(c.action, r.stage).toBe(label);
      // The loan-file stepper: the current step, or none (and the grey word) for a stage with no step.
      const at = stepperOf(r.stage);
      expect(at.current, r.stage).toBe(step);
      expect(at.word, r.stage).toBe(step === null ? label : null);
    }
  });
});
