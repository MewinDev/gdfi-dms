import "server-only";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { effectivePermissions } from "@/lib/auth/access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getHolidaySet, setSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import type { MyLoansRecord } from "@/lib/myloans/types";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, confirmPapersBack, markLabelsPrinted, recordEdst, requestMissingDocuments, saveChecklist } from "@/lib/services/workflow";
import { acceptJob, completeJob, declineJob, finishStage, forwardJob, loadAssignment, raiseProblem, receivePackage, somethingMissing, startStage, verifyPaper } from "@/lib/services/jobs";
import { stageRows, verifiablePapers } from "@/lib/services/job-stages";
import { returnToLa } from "@/lib/services/return-to-la";
import { addReceipt, closeAdvance, decideAdvance, notifyOverdue, releaseAdvance, requestAdvance } from "@/lib/services/funds";
import { raiseHold } from "@/lib/services/holds";
import { simulateSourceChange } from "@/lib/services/source-sync";
import { saveRole } from "@/lib/services/roles";
import { setRowActive } from "@/lib/services/settings-status";
import { BRANCH_NAMES, KIT_ACCOUNTS, KIT_LOANS, SUPERVISOR_ROLE_NAME, type KitAccountKey, type KitLoan } from "./catalog";
import { kitRefusal } from "./guard";
import { shiftBusinessDays } from "./rebase";

/**
 * Builds the kit's sample accounts and sample loans on an empty, migrated and seeded database. Every
 * loan goes through the app's own services (open, tick, send, accept, stages, funds, holds, returns,
 * MyLoans changes), so the data is what the screens would have made. Two things are set directly,
 * as the seed does: the accounts (the Users screen only takes @gdfi.ph emails; the kit uses
 * @example.test so no mail can reach anyone) and one due date moved into the past (the overdue case).
 */

type Users = Record<KitAccountKey, CurrentUser>;
type Log = (line: string) => void;

async function asUser(email: string): Promise<CurrentUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true, branches: { include: { branch: true } } } });
  const branchIds = u.branches.map((b) => b.branchId);
  return {
    id: u.id, email: u.email, name: u.name, roleKey: u.role.key, roleName: u.role.name, permissions: effectivePermissions(u.role) as Set<string>, branchIds,
    branchNames: u.branches.map((b) => b.branch.name), scopeBranchIds: u.role.branchAccess === "ALL" ? null : branchIds,
  };
}

async function createAccounts(log: Log): Promise<Users> {
  const branchId = async (code: string) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).id;
  const create = async (a: (typeof KIT_ACCOUNTS)[number], roleId: string) => {
    const branches = await Promise.all(a.branches.map(branchId));
    await prisma.user.create({ data: { email: a.email, name: a.name, roleId, isTestUser: true, branches: { create: branches.map((id) => ({ branchId: id })) } } });
  };
  const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key } })).id;
  // The Admin first: it makes the kit's Branch Supervisor role through the Roles screen's own code.
  const adminAcc = KIT_ACCOUNTS.find((a) => a.key === "admin")!;
  await create(adminAcc, await roleId("ADMIN"));
  const admin = await asUser(adminAcc.email);
  const sup = await saveRole(admin, null, {
    name: SUPERVISOR_ROLE_NAME, branchAccess: "ASSIGNED",
    description: "Sample role (Manual Test Kit): sees the loans of the assigned branches and may transfer holds.",
    permissions: [PERMISSIONS.LOANS_VIEW, PERMISSIONS.HOLDS_TRANSFER],
  });
  const supId = typeof sup === "object" && sup && "id" in sup ? String((sup as { id: string }).id) : (await prisma.role.findFirstOrThrow({ where: { name: SUPERVISOR_ROLE_NAME } })).id;
  for (const a of KIT_ACCOUNTS) {
    if (a.key === "admin") continue;
    await create(a, a.role === "SUPERVISOR" ? supId : await roleId(a.role));
  }
  const users = {} as Users;
  for (const a of KIT_ACCOUNTS) users[a.key] = await asUser(a.email);
  log(`Created ${KIT_ACCOUNTS.length} sample accounts (and the ${SUPERVISOR_ROLE_NAME} role).`);
  return users;
}

/** The sample loans in the sample MyLoans (Setting myloans.mockExtra), released N business days before today. */
async function sourceRecords(today: string, holidays: ReadonlySet<string>) {
  const records: MyLoansRecord[] = KIT_LOANS.map((l) => {
    const n = l.pn.slice(-4);
    return {
      pn: l.pn, cin: l.cin ?? `CIN-KIT-${n}`, cif: l.cin ? `CIF-${l.cin.slice(4)}` : `CIF-KIT-${n}`, sourceLoanId: `ML-KIT-${n}`,
      borrowerName: l.borrower, branchName: BRANCH_NAMES[l.branch], branchCode: l.branch, status: "RELEASED", loanType: l.loanType,
      productName: l.product, totalReleasedAmount: l.amount, releaseDate: shiftBusinessDays(today, -l.daysAgo, holidays),
      vehicle: { plateNo: `KIT ${n}`, engineNo: `ENG-K${n}`, chassisNo: `CHS-K${n}`, make: "Toyota Vios" },
      address: `${n} Mabini St, ${BRANCH_NAMES[l.branch]}`,
    };
  });
  await setSetting("myloans.mockExtra", records);
}

export async function buildSamples(log: Log = console.log): Promise<void> {
  const why = kitRefusal();
  if (why) throw new Error(why);
  const today = businessDate(new Date());
  const holidays = await getHolidaySet();
  const u = await createAccounts(log);
  await sourceRecords(today, holidays);
  await setSetting("email.active", false);
  await setSetting("samples.showDataCheck", false);
  await setSetting("myloans.simulateUnavailable", false);

  // ---- helpers (each one is the same call a screen makes) ----
  const loan = (pn: string) => prisma.loan.findUniqueOrThrow({ where: { pn } });
  const txn = (pn: string, code: string) => prisma.loanTransaction.findFirstOrThrow({ where: { loan: { pn }, type: { code } }, include: { checks: { include: { rule: true }, orderBy: { createdAt: "asc" } } } });
  const office = async (pn: string) => {
    const l = await prisma.loan.findUniqueOrThrow({ where: { pn }, include: { branch: true } });
    return (await prisma.ltoOffice.findFirstOrThrow({ where: { active: true, code: `LTO-${l.branch.code}` } })).id;
  };
  const open = (l: KitLoan) => openLoanFile(u[l.openedBy ?? "la1"], { pn: l.pn, financingType: l.picks?.financingType, orcrStatus: l.picks?.orcrStatus });
  const tick = async (by: CurrentUser, pn: string, code: string, leave: string[] = []) => {
    const t = await txn(pn, code);
    await saveChecklist(by, { transactionId: t.id, checkedIds: t.checks.filter((c) => !leave.includes(c.id)).map((c) => c.id), newOthers: [] });
    return t;
  };
  const labels = async (by: CurrentUser, transactionId: string) => {
    const docs = await prisma.documentItem.findMany({ where: { transactionId, documentId: { not: null }, labelPrintedAt: null }, select: { id: true } });
    if (docs.length) await markLabelsPrinted(by, docs.map((d) => d.id));
  };
  const latestJob = (transactionId: string) => prisma.dpAssignment.findFirstOrThrow({ where: { transactionId }, orderBy: { createdAt: "desc" } });
  /** Tick every paper, print the labels and send to a processor (Send step). */
  const send = async (pn: string, code: string, dp: CurrentUser, o: { by?: CurrentUser; funds?: string[]; tick?: boolean } = {}) => {
    const by = o.by ?? u.la1;
    const t = o.tick === false ? await txn(pn, code) : await tick(by, pn, code);
    await labels(by, t.id);
    const l = await loan(pn);
    await assignToDp(by, {
      transactionId: t.id, dpBranchId: l.branchId, dpUserId: dp.id, ltoOfficeId: await office(pn), fundsNeeded: o.funds ? "YES" : "NO", fundsKinds: o.funds ?? [],
      beyondTatReason: null, pasuyo: false, secondaryDpUserId: null, pasuyoReason: null,
    });
    return { t, job: await latestJob(t.id) };
  };
  const accepted = async (pn: string, code: string, dp: CurrentUser, funds?: string[]) => {
    const s = await send(pn, code, dp, { funds });
    await acceptJob(dp, s.job.id, true);
    return s;
  };
  /** Works the stages in order: `count` of them, or up to (not into) Check and verify. */
  const work = async (dp: CurrentUser, jobId: string, stop: number | "VERIFY" | "ALL") => {
    let done = 0;
    for (;;) {
      const a = await loadAssignment(prisma, jobId);
      const row = (await stageRows(prisma, a)).find((r) => r.status !== "DONE");
      if (!row) return;
      if (typeof stop === "number" && done >= stop) return;
      if (stop === "VERIFY" && row.kind === "VERIFY") return;
      if (row.status === "LATER") await startStage(dp, jobId, row.id ?? row.code);
      const cur = (await stageRows(prisma, await loadAssignment(prisma, jobId))).find((r) => r.code === row.code)!;
      if (cur.kind === "VERIFY") {
        for (const d of verifiablePapers(a.transaction.documents)) await verifyPaper(dp, jobId, cur.id!, d.id);
        await finishStage(dp, jobId, cur.id!, { note: "Every paper back and complete" });
      } else {
        const raw: Record<string, unknown> = {};
        for (const f of cur.fields) {
          raw[f.key] = f.key === "office" && a.ltoOffice ? a.ltoOffice.name : f.type === "date" ? today : f.type === "tick" ? "on" : f.type === "number" ? "1" : f.type === "file" ? "On file" : `Sample ${f.label.toLowerCase()}`;
        }
        await finishStage(dp, jobId, cur.id!, raw);
      }
      done++;
    }
  };
  const reason = {
    hold: async (code: string) => (await prisma.holdReason.findUniqueOrThrow({ where: { code } })).id,
    problem: async (code: string) => (await prisma.problemReason.findUniqueOrThrow({ where: { code } })).id,
    ret: async (code: string) => (await prisma.returnReason.findUniqueOrThrow({ where: { code } })).id,
  };
  const papers = async (transactionId: string) => (await prisma.documentItem.findMany({ where: { transactionId }, select: { id: true } })).map((d) => d.id);
  const fund = async (pn: string, dp: CurrentUser, upTo: "requested" | "approved" | "released") => {
    const t = await txn(pn, "MORTGAGE");
    const r = await requestAdvance(dp, { lines: [{ transactionId: t.id, kind: "LTO_FEE", cents: 350_000 }] });
    if (upTo !== "requested") await decideAdvance(u.finance, r.id, { approve: true });
    if (upTo === "released") await releaseAdvance(u.finance, r.id, { ref: `CV-${pn.slice(-4)}` });
    return { advanceId: r.id, lineId: (await prisma.cashAdvanceLine.findFirstOrThrow({ where: { advanceId: r.id } })).id };
  };

  // ---- open every loan that is opened in the DMS ----
  for (const l of KIT_LOANS.filter((x) => x.opened)) await open(l);
  log(`Opened ${KIT_LOANS.filter((x) => x.opened).length} loan files (Find loan, Open Loan File).`);

  const cases: Record<string, () => Promise<unknown>> = {
    // Loan Associate
    "PN-0002011": () => tick(u.la1, "PN-0002011", "MORTGAGE"),
    "PN-0002012": async () => {
      const t = await txn("PN-0002012", "NOTARY");
      const missing = t.checks.find((c) => c.required)!;
      await tick(u.la1, "PN-0002012", "NOTARY", [missing.id]);
      await requestMissingDocuments(u.la1, { transactionId: t.id, checkIds: [missing.id], askedFrom: "BORROWER", note: "The borrower brings it on Monday." });
    },
    "PN-0002013": async () => {
      await raiseHold(u.la1, { transactionId: (await txn("PN-0002013", "NOTARY")).id, reasonId: await reason.hold("CLIENT-PAPERS"), note: "Waiting for the signed deed of sale from the borrower." });
      await raiseHold(u.la2, { transactionId: (await txn("PN-0002013", "PPSR")).id, reasonId: await reason.hold("BRANCH-HEAD"), note: "Branch head to approve the PPSR fee first." });
    },
    "PN-0002014": () => send("PN-0002014", "NOTARY", u.dp1),
    "PN-0002015": () => send("PN-0002015", "NOTARY", u.dp1),
    "PN-0002016": () => send("PN-0002016", "NOTARY", u.dp2),
    "PN-0002017": async () => {
      const { t, job } = await accepted("PN-0002017", "NOTARY", u.dp1);
      const id = t.checks.find((c) => c.required && /ID/i.test(c.rule?.label ?? ""))?.id ?? t.checks.find((c) => c.required)!.id;
      await returnToLa(u.dp1, job.id, { reasonId: await reason.ret("MISSING"), checkIds: [id], note: "The ID copy is unreadable. Bring a clear copy.", handedOver: await papers(t.id) });
    },
    "PN-0002018": async () => {
      const { t, job } = await accepted("PN-0002018", "NOTARY", u.dp1);
      await returnToLa(u.dp1, job.id, { reasonId: await reason.ret("OTHER"), note: "The deed of sale must be signed on every page.", handedOver: await papers(t.id) });
      await confirmPapersBack(u.la1, { transactionId: t.id, notReceived: [] });
      await send("PN-0002018", "NOTARY", u.dp1); // round 2, waiting for DP 1
    },
    "PN-0002019": async () => {
      const { job } = await send("PN-0002019", "NOTARY", u.dp1, { by: u.laInactive });
      await declineJob(u.dp1, job.id, { reasons: ["Wrong job for me"], remarks: "This one is for the Cebu processor." });
      await setRowActive(u.admin, "user", u.laInactive.id, false); // the sender has since left
    },
    // DP stages
    "PN-0002020": async () => { const { job } = await accepted("PN-0002020", "NOTARY", u.dp1); await work(u.dp1, job.id, 1); },
    "PN-0002021": async () => { const { job } = await accepted("PN-0002021", "PPSR", u.dp1); await work(u.dp1, job.id, 1); },
    "PN-0002022": async () => { const { job } = await accepted("PN-0002022", "MORTGAGE", u.dp1); await work(u.dp1, job.id, 1); },
    "PN-0002023": async () => {
      const { job } = await accepted("PN-0002023", "NOTARY", u.dp1);
      await work(u.dp1, job.id, "VERIFY");
      const a = await loadAssignment(prisma, job.id);
      const v = (await stageRows(prisma, a)).find((r) => r.kind === "VERIFY")!;
      await startStage(u.dp1, job.id, v.id ?? v.code);
      const vid = (await stageRows(prisma, await loadAssignment(prisma, job.id))).find((r) => r.kind === "VERIFY")!.id!;
      const docs = verifiablePapers(a.transaction.documents);
      await verifyPaper(u.dp1, job.id, vid, docs[0].id);
      await somethingMissing(u.dp1, job.id, vid, [docs[1].id], "Not in the folder that came back from the notary.");
    },
    "PN-0002024": async () => { await accepted("PN-0002024", "MORTGAGE", u.dp1, ["LTO_FEE"]); await fund("PN-0002024", u.dp1, "released"); },
    "PN-0002025": async () => {
      const { t } = await accepted("PN-0002025", "NOTARY", u.dp1);
      await raiseHold(u.dp1, { transactionId: t.id, reasonId: await reason.hold("CLIENT-DECISION"), note: "The borrower is deciding whether to add a co-maker." });
    },
    "PN-0002026": async () => {
      const { t } = await accepted("PN-0002026", "NOTARY", u.dp1);
      await raiseProblem(u.dp1, { transactionId: t.id, reasonId: await reason.problem("LTO_DOWN"), note: "LTO system down the whole morning." });
    },
    "PN-0002027": async () => {
      const { job } = await accepted("PN-0002027", "NOTARY", u.dp1);
      await work(u.dp1, job.id, "ALL");
      await completeJob(u.dp1, job.id, {});
      await forwardJob(u.dp1, job.id, { branchId: (await prisma.branch.findUniqueOrThrow({ where: { code: "MKT" } })).id, receivingLaId: u.laMakati.id, note: "The borrower collects at Makati." });
    },
    "PN-0002028": async () => {
      const e = await tick(u.la1, "PN-0002028", "EDST");
      await recordEdst(u.la1, { transactionId: e.id, reference: "EDST-2028" });
      const { job } = await accepted("PN-0002028", "NOTARY", u.dp1);
      await work(u.dp1, job.id, "ALL");
      await completeJob(u.dp1, job.id, {});
      await forwardJob(u.dp1, job.id, { branchId: (await loan("PN-0002028")).branchId, receivingLaId: u.la1.id });
      await receivePackage(u.la1, job.id, { result: "complete", note: "" });
    },
    "PN-0002029": async () => {
      const { job } = await accepted("PN-0002029", "NOTARY", u.dp1);
      await work(u.dp1, job.id, "ALL");
      await completeJob(u.dp1, job.id, {});
      await forwardJob(u.dp1, job.id, { branchId: (await loan("PN-0002029")).branchId, receivingLaId: u.la1.id });
      await receivePackage(u.la1, job.id, { result: "incomplete", note: "The notarized deed of sale is missing from the package." });
    },
    // Funds
    "PN-0002030": () => accepted("PN-0002030", "MORTGAGE", u.dp1, ["LTO_FEE"]),
    "PN-0002031": async () => { await accepted("PN-0002031", "MORTGAGE", u.dp1, ["LTO_FEE"]); await fund("PN-0002031", u.dp1, "requested"); },
    "PN-0002032": async () => { await accepted("PN-0002032", "MORTGAGE", u.dp1, ["LTO_FEE"]); await fund("PN-0002032", u.dp1, "approved"); },
    "PN-0002033": async () => { await accepted("PN-0002033", "MORTGAGE", u.dp2, ["LTO_FEE"]); await fund("PN-0002033", u.dp2, "released"); },
    "PN-0002035": async () => {
      await accepted("PN-0002035", "MORTGAGE", u.dp2, ["LTO_FEE"]);
      const { lineId } = await fund("PN-0002035", u.dp2, "released");
      await addReceipt(u.dp2, { lineId, date: today, cents: 350_000, number: "OR-2035" }, null);
    },
    "PN-0002036": async () => {
      await accepted("PN-0002036", "MORTGAGE", u.dp2, ["LTO_FEE"]);
      const { advanceId, lineId } = await fund("PN-0002036", u.dp2, "released");
      await addReceipt(u.dp2, { lineId, date: today, cents: 350_000, number: "OR-2036" }, null);
      await closeAdvance(u.finance, advanceId);
    },
    "PN-0002037": async () => {
      const { t, job } = await accepted("PN-0002037", "MORTGAGE", u.dp2, ["LTO_FEE"]);
      await fund("PN-0002037", u.dp2, "released");
      await returnToLa(u.dp2, job.id, { reasonId: await reason.ret("OTHER-TXN"), note: "Needs the PPSR entry done first.", handedOver: await papers(t.id) });
    },
    // TAT: papers ticked, ready to send
    "PN-0002038": () => tick(u.la1, "PN-0002038", "NOTARY"),
    "PN-0002039": () => tick(u.la1, "PN-0002039", "NOTARY"),
    "PN-0002040": () => tick(u.la1, "PN-0002040", "NOTARY"),
    // MyLoans changes (the simulator in Settings, as Admin)
    "PN-0002041": async () => simulateSourceChange(u.admin, (await loan("PN-0002041")).id, "name"),
    "PN-0002042": async () => simulateSourceChange(u.admin, (await loan("PN-0002042")).id, "amount"),
    "PN-0002043": async () => simulateSourceChange(u.admin, (await loan("PN-0002043")).id, "cancel"),
    "PN-0002044": async () => simulateSourceChange(u.admin, (await loan("PN-0002044")).id, "replace"),
    // Last: an overdue advance blocks the processor's next request (as it should), so it comes after the others.
    "PN-0002034": async () => {
      await accepted("PN-0002034", "MORTGAGE", u.dp2, ["LTO_FEE"]);
      const { advanceId } = await fund("PN-0002034", u.dp2, "released");
      // The one date set directly: the liquidation was due 2 business days ago; then the daily overdue check runs.
      const due = shiftBusinessDays(today, -2, holidays);
      await prisma.cashAdvance.update({ where: { id: advanceId }, data: { liquidationDueAt: new Date(`${due}T17:00:00+08:00`) } });
      await notifyOverdue();
    },
  };

  for (const [pn, fn] of Object.entries(cases)) {
    try {
      await fn();
    } catch (e) {
      throw new Error(`Sample loan ${pn}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  log(`Prepared ${Object.keys(cases).length} sample cases through the app's own steps.`);
}
