/**
 * Journey v2 (Story, By document, "Where it is now") from a real loan, through the same loader the
 * tab uses: sent, held and resumed, returned with the papers handed back and confirmed, sent again
 * (Round 2), funds released, worked and forwarded. Reading it writes nothing.
 * Test database only; removes all loan files first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, confirmPapersBack, saveChecklist } from "@/lib/services/workflow";
import { acceptJob, completeJob } from "@/lib/services/jobs";
import { returnToLa } from "@/lib/services/return-to-la";
import { raiseHold, resumeHold } from "@/lib/services/holds";
import { decideAdvance, releaseAdvance, requestAdvance } from "@/lib/services/funds";
import { getLoanForUser } from "@/lib/services/queries";
import { loadJourney } from "@/lib/services/journey";
import { setSetting } from "@/lib/settings";
import { allPapers, asUser, cleanLoans, forwardToLoanBranch, workStages } from "./helpers";

const PN = "GD1652026901003";
let la: CurrentUser, dp: CurrentUser, fin: CurrentUser;

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  fin = await asUser("test.finance@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
  await setSetting("funds.blockLtoUntilFunded", true);
});
afterAll(async () => { await prisma.$disconnect(); });

async function txnOf(code: string) {
  return prisma.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code } }, include: { checks: true } });
}
async function send(code: string, needed: "YES" | "NO", kinds: string[] = []) {
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
  const txn = await txnOf(code);
  await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.map((c) => c.id), newOthers: [] });
  const lto = await prisma.ltoOffice.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(la, {
    transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto?.id ?? null, fundsNeeded: needed, fundsKinds: kinds,
    beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null,
  });
  return prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id }, orderBy: { createdAt: "desc" } });
}
/** Every table's row count (to show that reading the Journey writes nothing). */
async function rowCounts(): Promise<Record<string, number>> {
  const tables = await prisma.$queryRawUnsafe<{ t: string }[]>(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`);
  const out: Record<string, number> = {};
  for (const { t } of tables) out[t] = Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t}"`))[0].n);
  return out;
}

describe("Journey v2 from the records", () => {
  it("sent, hold and resume, returned with papers back, Round 2, funds, forwarded: the Story lines, the milestones and the strip", async () => {
    await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const job1 = await send("MORTGAGE", "NO");
    await acceptJob(dp, job1.id, true);
    const borrower = (await prisma.holdReason.findUniqueOrThrow({ where: { code: "CLIENT-PAPERS" } })).id;
    const holdId = await raiseHold(dp, { transactionId: job1.transactionId, reasonId: borrower, note: "Borrower to bring the OR/CR" });
    await resumeHold(dp, holdId, "Borrower brought it");
    const reason = (await prisma.returnReason.findUniqueOrThrow({ where: { code: "MISSING" } })).id;
    const check = (await txnOf("MORTGAGE")).checks.find((c) => c.required)!;
    await returnToLa(dp, job1.id, { reasonId: reason, checkIds: [check.id], note: "The ID copy is unreadable", handedOver: await allPapers(job1.transactionId) });
    await confirmPapersBack(la, { transactionId: job1.transactionId, notReceived: [] });
    const job2 = await send("MORTGAGE", "YES", ["LTO_FEE"]);
    await acceptJob(dp, job2.id, true);
    const adv = await requestAdvance(dp, { lines: [{ transactionId: job2.transactionId, kind: "LTO_FEE", cents: 150000, overMaxReason: "Integration test" }] });
    await decideAdvance(fin, adv.id, { approve: true });
    await releaseAdvance(fin, adv.id, { ref: "VOUCHER-1" });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    await workStages(dp, job2.id, { droppedAt: today, pickedUpAt: today, annotatedOrCr: "on" });
    await completeJob(dp, job2.id, {});
    await forwardToLoanBranch(dp, job2.id, la.id);

    const before = await rowCounts();
    const loan = (await getLoanForUser(la, PN))!;
    const { story } = await loadJourney(la, loan);
    await loadJourney(fin, (await getLoanForUser(fin, PN))!);
    // Reading the Journey wrote nothing.
    expect(await rowCounts()).toEqual(before);

    const s = story.lines.map((l) => l.sentence);
    const has = (re: RegExp) => expect(s.some((x) => re.test(x)), `${re} in\n${s.join("\n")}`).toBe(true);
    has(/^Test Loan Associate opened the loan file$/);
    has(/^4 transactions created: Notary, EDST, Entry of PPSR and Mortgage$/);
    has(/^Test Loan Associate sent Mortgage to Test Document Processor$/);
    has(/^Test Document Processor accepted Mortgage$/);
    has(/^Test Document Processor put Mortgage on hold: .+ \(Borrower to bring the OR\/CR\)$/);
    has(/^Test Document Processor resumed Mortgage: Borrower brought it$/);
    has(/^Test Document Processor returned Mortgage: .*The ID copy is unreadable.* \(Round 1\)$/);
    has(/^Test Document Processor handed the Mortgage papers back to Test Loan Associate$/);
    has(/^Test Loan Associate received the Mortgage papers back from Test Document Processor$/);
    has(/^Test Loan Associate sent Mortgage to Test Document Processor again \(Round 2\)$/);
    has(/^Test Document Processor finished the work on Mortgage$/);
    has(/^Test Document Processor forwarded Mortgage to Test Loan Associate$/);
    has(/^Loan opened and checked automatically$/);
    // The reason is said once; nothing is said twice; the newest is first.
    expect(s.filter((x) => x.includes("The ID copy is unreadable"))).toHaveLength(1);
    expect(new Set(story.lines.map((l) => `${l.at.getTime()}|${l.sentence}`)).size).toBe(story.lines.length);
    expect(story.lines.map((l) => l.at.getTime())).toEqual([...story.lines.map((l) => l.at.getTime())].sort((a, b) => b - a));
    expect(story.lines.filter((l) => l.flag).map((l) => l.flag).sort()).toEqual(["hold", "return"]);
    // No cash amounts for the LA, in any of the three.
    expect(JSON.stringify(story)).not.toMatch(/₱|1,500/);

    const m = story.columns.find((c) => c.code === "MORTGAGE")!;
    expect(m.milestones.map((x) => `${x.key}:${x.state}`)).toEqual(["opened:done", "checked:done", "processor:done", "process:done", "back:done", "done:now"]);
    const proc = m.milestones.find((x) => x.key === "processor")!;
    expect(proc.markers.map((x) => [x.kind, x.round])).toEqual(expect.arrayContaining([["return", 1], ["hold", null]]));
    expect(m.milestones.flatMap((x) => x.markers).some((x) => x.kind === "funds" && /CA-\d{4}-\d+: Funded/.test(x.text))).toBe(true);
    expect(m.milestones.find((x) => x.key === "back")).toMatchObject({ who: "Test Document Processor", sub: "To Test Loan Associate" });
    expect(m.milestones.filter((x) => x.state === "done").every((x) => x.at)).toBe(true);

    // The strip: Mortgage on its way back; the other three still with the LA, on one line.
    expect(story.where).toHaveLength(2);
    expect(story.where.map((w) => [w.label, w.kind, w.text])).toEqual(expect.arrayContaining([
      ["Notary, EDST and Entry of PPSR", "now", "With LA Test Loan Associate"],
      ["Mortgage", "now", "On the way to LA Test Loan Associate"],
    ]));
  });
});
