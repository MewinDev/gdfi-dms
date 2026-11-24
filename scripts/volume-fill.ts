/**
 * Fills gdfi_dms_volume_test (scripts/volume.ts; D-055) with fake data at about production scale. Fake borrowers only.
 * 15,000 loans (3,000 each at Antipolo and Angono, the test LA's branches; the rest spread over every branch), two
 * transactions each, an LA work item per open transaction, 2,000 released loans waiting in the branch pools, 4,000 Open
 * Items (half pending), 60,000 file access log rows and 30,000 audit rows.
 */
import { prisma } from "@/lib/db";

const LOANS = 15_000;
const DAY = 86_400_000;
const chunk = async <T,>(rows: T[], size: number, f: (part: T[]) => Promise<unknown>) => { for (let i = 0; i < rows.length; i += size) await f(rows.slice(i, i + size)); };
const pick = <T,>(xs: T[], i: number) => xs[i % xs.length];

(async () => {
  const t0 = Date.now();
  const db = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  if (db !== "gdfi_dms_volume_test") throw new Error(`Refused: this fills gdfi_dms_volume_test only, not ${db}.`);
  const branches = await prisma.branch.findMany({ where: { active: true, hidden: false }, select: { id: true, code: true } });
  const [antipolo, angono] = ["101", "165"].map((c) => branches.find((b) => b.code === c)!.id);
  const la = await prisma.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  const types = await prisma.transactionType.findMany({ where: { code: { in: ["NOTARY", "MORTGAGE"] } }, select: { id: true, code: true } });
  const stages = ["For checklist", "Ready to send", "Assigned to DP", "In process", "For Vault Transmittal"];
  const now = Date.now();

  // Loans.
  const loans = Array.from({ length: LOANS }, (_, i) => {
    const branchId = i < 3000 ? antipolo : i < 6000 ? angono : pick(branches, i).id;
    return {
      pn: `GD9${String(500_000_000_000 + i).slice(-13)}`, borrowerName: `Volume Borrower ${i}`, branchId, loanType: i % 3 ? "New" : "Renewal",
      productName: i % 4 ? "Auto Refinancing" : "Auto Financing", totalReleasedAmount: 300_000 + (i % 50) * 10_000,
      releasedAt: new Date(now - (i % 120) * DAY), sourceStatus: "RELEASED", retrievedAt: new Date(now - (i % 10) * DAY), openedById: la.id,
      classification: (i % 4 ? "REFINANCING" : "FINANCING") as "REFINANCING" | "FINANCING", mortgageResult: "MORTGAGE" as const, ruleFired: "volume test",
      stage: pick(stages, i), stageSince: new Date(now - (i % 20) * DAY), cin: `CIN-VOL-${i}`, cif: `CIF-VOL-${i}`,
    };
  });
  await chunk(loans, 2000, (p) => prisma.loan.createMany({ data: p as never }));
  const ids = await prisma.loan.findMany({ where: { borrowerName: { startsWith: "Volume Borrower" } }, select: { id: true, pn: true, branchId: true } });
  console.log(`- ${ids.length} loans`);

  // Two transactions each, and an LA work item for each open one (held by the LA at their branches, else pooled).
  const txns = ids.flatMap((l, i) => types.map((t) => ({ loanId: l.id, typeId: t.id, status: (i % 5 === 4 ? "COMPLETED" : "FOR_CHECKLIST") as never })));
  await chunk(txns, 4000, (p) => prisma.loanTransaction.createMany({ data: p as never }));
  const tx = await prisma.loanTransaction.findMany({ where: { status: "FOR_CHECKLIST", loan: { borrowerName: { startsWith: "Volume Borrower" } } }, select: { id: true, loanId: true, loan: { select: { pn: true, branchId: true } } } });
  const items = tx.map((t, i) => {
    const mine = (t.loan.branchId === antipolo || t.loan.branchId === angono) && i % 3 === 0;
    return {
      kind: "TRANSACTION", subjectId: t.id, role: "LA", branchId: t.loan.branchId, loanId: t.loanId, pn: t.loan.pn, label: `${t.loan.pn}: volume`,
      state: mine ? "HELD" : "POOL", holderUserId: mine ? la.id : null, arrivedAt: new Date(now - (i % 15) * DAY), acceptedAt: mine ? new Date(now - (i % 10) * DAY) : null,
      dueDate: new Date(now + ((i % 9) - 3) * DAY).toISOString().slice(0, 10), measure: mine ? "TAT" : "WAITING",
    };
  });
  await chunk(items, 4000, (p) => prisma.workItem.createMany({ data: p }));
  console.log(`- ${txns.length} transactions, ${items.length} work items`);

  // Processor jobs (the TAT report and Jobs read these): 6,000 transactions sent to the test processor, in process.
  const dp = await prisma.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } });
  const sent = (await prisma.loanTransaction.findMany({ where: { status: "FOR_CHECKLIST", loan: { borrowerName: { startsWith: "Volume Borrower" } } }, select: { id: true, loanId: true, loan: { select: { branchId: true } } }, take: 6000 }));
  await chunk(sent.map((t, i) => ({
    loanId: t.loanId, transactionId: t.id, dpBranchId: t.loan.branchId, dpUserId: dp.id, assignedById: la.id, status: (i % 3 ? "ACCEPTED" : "PENDING_ACCEPTANCE") as never,
    endorsedAt: new Date(now - (i % 12) * DAY), dueDate: new Date(now + ((i % 9) - 4) * DAY).toISOString().slice(0, 10),
  })), 2000, (p) => prisma.dpAssignment.createMany({ data: p as never }));
  await prisma.loanTransaction.updateMany({ where: { id: { in: sent.map((t) => t.id) } }, data: { status: "IN_PROCESS" } });
  console.log(`- ${sent.length} processor jobs`);

  // Released loans not yet in the DMS, waiting in the branch pools (10b).
  const cands = Array.from({ length: 2000 }, (_, i) => ({ externalLoanId: 800_000 + i, pn: `GD8${String(600_000_000_000 + i).slice(-13)}`, borrowerName: `Volume Candidate ${i}`, branchCode: pick(branches, i).code, myloansBranchId: null, amount: "250000.00", releaseDate: new Date(now - (i % 30) * DAY), cin: `CIN-VC-${i}` }));
  await chunk(cands, 2000, (p) => prisma.sourceLoanCandidate.createMany({ data: p }));
  await chunk(cands.map((c, i) => ({ kind: "LOAN_CANDIDATE", subjectId: c.pn, role: "LA", branchId: i < 400 ? (i % 2 ? antipolo : angono) : pick(branches, i).id, pn: c.pn, label: `${c.pn}: ${c.borrowerName}`, state: "POOL", arrivedAt: new Date(now - (i % 6) * DAY), measure: "WAITING" })), 2000, (p) => prisma.workItem.createMany({ data: p }));
  console.log(`- ${cands.length} released loans in the pools`);

  // Open Items: half pending (one per loan and field), half decided.
  const fields = [["amount", "Amount", "rules", "LOAN"], ["cif", "CIF", null, "BORROWER"], ["sourceLoanId", "Source loan ID", null, "LOAN"]] as const;
  const ois = Array.from({ length: 4000 }, (_, i) => {
    const l = ids[i * 3];
    const f = pick([...fields], i);
    const pending = i % 2 === 0;
    return {
      number: `OI-2026-${String(i + 1).padStart(6, "0")}`, loanId: l.id, branchId: l.branchId, field: f[0], fieldLabel: f[1], groupKey: f[2], audience: f[3],
      oldValue: "old", newValue: "new", raisedAt: new Date(now - (i % 12) * DAY), status: (pending ? "PENDING" : "APPROVED") as never,
      ...(pending ? {} : { decidedAt: new Date(now - (i % 5) * DAY), decidedById: admin.id, decidedByLabel: admin.name, remarks: "Volume test" }),
    };
  });
  await chunk(ois, 2000, (p) => prisma.openItem.createMany({ data: p }));
  await prisma.openItemCounter.create({ data: { year: 2026, last: 4000 } });
  console.log(`- ${ois.length} Open Items`);

  // File access log and audit rows.
  const logs = Array.from({ length: 60_000 }, (_, i) => {
    const l = ids[i % ids.length];
    return { userId: i % 2 ? la.id : admin.id, entityType: "RECEIPT", entityId: `vol-${i}`, loanId: l.id, pn: l.pn, branchId: l.branchId, fileKey: `vol-${i}.jpg`, fileName: "receipt.jpg", action: i % 7 ? "VIEW" : "DOWNLOAD", at: new Date(now - (i % 90) * DAY) };
  });
  await chunk(logs, 5000, (p) => prisma.fileAccessLog.createMany({ data: p }));
  const audits = Array.from({ length: 30_000 }, (_, i) => {
    const l = ids[i % ids.length];
    return { actorId: la.id, actorLabel: la.name, mode: "MANUAL" as const, action: "volume_test", entityType: "Loan", entityId: l.id, loanId: l.id, pn: l.pn, summary: "Volume test row", at: new Date(now - (i % 90) * DAY) };
  });
  await chunk(audits, 5000, (p) => prisma.auditLog.createMany({ data: p }));
  console.log(`- ${logs.length} file access log rows, ${audits.length} audit rows`);
  await prisma.$executeRawUnsafe("ANALYZE");
  console.log(`Filled in ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; await prisma.$disconnect(); });
