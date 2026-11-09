import "server-only";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { CURRENT_USER_INCLUDE, toCurrentUser } from "@/lib/auth/build-user";
import { PERMISSIONS, ROLE_DEFAULTS } from "@/lib/auth/permissions";
import { getHolidaySet, setSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import type { MyLoansRecord } from "@/lib/myloans/types";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, confirmPapersBack, markLabelsPrinted, recordEdst, requestMissingDocuments, saveChecklist } from "@/lib/services/workflow";
import { acceptJob, completeJob, declineJob, finishStage, forwardJob, loadAssignment, raiseProblem, receivePackage, somethingMissing, startStage, verifyPaper } from "@/lib/services/jobs";
import { stageRows, verifiablePapers } from "@/lib/services/job-stages";
import { returnToLa } from "@/lib/services/return-to-la";
import { addReceipt, changeFundsType, closeAdvance, decideAdvance, notifyOverdue, releaseAdvance, requestAdvance } from "@/lib/services/funds";
import { raiseHold } from "@/lib/services/holds";
import { applySourceChange, simulateSourceChange } from "@/lib/services/source-sync";
import { acceptReview, importBranchRowsAsSystem, runBranchSync } from "@/lib/services/branches";
import { BUILTIN_BRANCHES, BUILTIN_USUAL_LTO, KIT_BRANCH_FILE } from "@/lib/branches/builtin";
import { looksLikeTestBranch } from "@/lib/branches/file";
import { readKitBranchFile } from "@/lib/branches/kit-file";
import { saveRole } from "@/lib/services/roles";
import { saveDpCapacity } from "@/lib/services/dp-capacity";
import { fileAdvisory, resolveAdvisory } from "@/lib/services/lto-advisories";
import { saveSettingsRow } from "@/lib/services/admin";
import { setRowActive } from "@/lib/services/settings-status";
import { BRANCH_NAMES, KIT_ACCOUNTS, KIT_BRANCH_CHANGES, KIT_LOANS, KIT_OTHER_SAMPLES, SUPERVISOR_ROLE_NAME, NO_REFRESH_ROLE_NAME, type KitAccountKey, type KitLoan } from "./catalog";
import { kitRefusal } from "./guard";
import { branchGrants, writeUserAccess, type AccessInput } from "@/lib/services/access";
import type { GrantLike } from "@/lib/branches/access";
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
  return toCurrentUser(await prisma.user.findUniqueOrThrow({ where: { email }, include: CURRENT_USER_INCLUDE }));
}

/** A kit account's branch access: All, single branches, whole areas (by division and area name) and exceptions. */
export async function kitAccess(a: { branches: string[] | "ALL"; access?: { areas?: { division: string; area: string }[]; except?: string[]; home?: string } }, branchId: (code: string) => Promise<string>): Promise<AccessInput> {
  if (a.branches === "ALL") return { all: true, grants: [], homeBranchId: null };
  const grants: GrantLike[] = branchGrants(await Promise.all(a.branches.map(branchId)));
  for (const g of a.access?.areas ?? []) {
    const area = await prisma.area.findFirstOrThrow({ where: { name: g.area } });
    const division = await prisma.division.findFirstOrThrow({ where: { name: g.division } });
    grants.push({ kind: "AREA", divisionId: division.id, areaId: area.id, branchId: null, exclude: false });
  }
  for (const code of a.access?.except ?? []) grants.push({ kind: "BRANCH", divisionId: null, areaId: null, branchId: await branchId(code), exclude: true });
  const home = a.access?.home ?? a.branches[0];
  return { all: false, grants, homeBranchId: home ? await branchId(home) : null };
}

async function createAccounts(log: Log): Promise<Users> {
  const branchId = async (code: string) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).id;
  const create = async (a: (typeof KIT_ACCOUNTS)[number], roleId: string) => {
    const made = await prisma.user.create({ data: { email: a.email, name: a.name, roleId, isTestUser: true } });
    await prisma.$transaction(async (tx) => writeUserAccess(tx, made.id, await kitAccess(a, branchId)));
  };
  const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key } })).id;
  // The Admin first: it makes the kit's Branch Supervisor role through the Roles screen's own code.
  const adminAcc = KIT_ACCOUNTS.find((a) => a.key === "admin")!;
  await create(adminAcc, await roleId("ADMIN"));
  const admin = await asUser(adminAcc.email);
  const sup = await saveRole(admin, null, {
    name: SUPERVISOR_ROLE_NAME, branchAccess: "ASSIGNED",
    description: "Sample role (Manual Test Kit): sees the loans of the assigned branches, refreshes them from MyLoans and may transfer holds.",
    permissions: [PERMISSIONS.LOANS_VIEW, PERMISSIONS.HOLDS_TRANSFER, PERMISSIONS.MYLOANS_VIEW, PERMISSIONS.LOANS_REFRESH],
  });
  const supId = typeof sup === "object" && sup && "id" in sup ? String((sup as { id: string }).id) : (await prisma.role.findFirstOrThrow({ where: { name: SUPERVISOR_ROLE_NAME } })).id;
  // "LA (no refresh)": every Loan Associate tick except Refresh, so Admin can tick it and see the button appear.
  const noRefreshId = await saveRole(admin, null, {
    name: NO_REFRESH_ROLE_NAME, branchAccess: "ASSIGNED",
    description: "Sample role (Manual Test Kit): a Loan Associate without \"Refresh a loan from MyLoans\". Tick it in Settings, Roles to try it.",
    permissions: ROLE_DEFAULTS.LA.permissions.filter((k) => k !== PERMISSIONS.LOANS_REFRESH),
  });
  const kitRole = async (r: (typeof KIT_ACCOUNTS)[number]["role"]) => (r === "SUPERVISOR" ? supId : r === "LA_NO_REFRESH" ? noRefreshId : roleId(r));
  for (const a of KIT_ACCOUNTS) {
    if (a.key === "admin") continue;
    await create(a, await kitRole(a.role));
  }
  const users = {} as Users;
  for (const a of KIT_ACCOUNTS) users[a.key] = await asUser(a.email);
  log(`Created ${KIT_ACCOUNTS.length} sample accounts (and the ${SUPERVISOR_ROLE_NAME} and ${NO_REFRESH_ROLE_NAME} roles).`);
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

/**
 * The kit's branches, through the same import code as Settings, Branches, Import from MyLoans: the real
 * MyLoans list (storage/kit/myloans-branches.csv, Git-ignored) when it is there, otherwise the built-in
 * subset. The sample branches of the subset are always added (Alicia-Inactive is not in the export). Rows
 * that look like test or unused branches are left out, so a manual Import shows them as suggestions.
 */
export async function importKitBranches(log: Log) {
  const file = readKitBranchFile();
  const codes = new Set((file?.rows ?? []).map((r) => r.code));
  const rows = [...(file?.rows ?? []).filter((r) => !looksLikeTestBranch(r)), ...BUILTIN_BRANCHES.filter((r) => !codes.has(r.code))];
  const r = await importBranchRowsAsSystem(rows, file ? KIT_BRANCH_FILE : "built-in subset");
  for (const [code, lto] of Object.entries(BUILTIN_USUAL_LTO)) {
    const office = await prisma.ltoOffice.findUnique({ where: { code: lto } });
    if (office) await prisma.branch.updateMany({ where: { code }, data: { usualLtoOfficeId: office.id } });
  }
  const [d, a, b] = await Promise.all([prisma.division.count(), prisma.area.count(), prisma.branch.count()]);
  log(file
    ? `Imported the real MyLoans branch list from ${KIT_BRANCH_FILE}: ${d} divisions, ${a} areas, ${b} branches (${r.applied} added; ${file.rows.filter(looksLikeTestBranch).length} test-looking rows left for the Import preview${file.problems ? `; ${file.problems} rows with a problem skipped` : ""}).`
    : `Imported the built-in branch subset (${KIT_BRANCH_FILE} not found): ${d} divisions, ${a} areas, ${b} branches.`);
}

export async function buildSamples(log: Log = console.log): Promise<void> {
  const why = kitRefusal();
  if (why) throw new Error(why);
  const today = businessDate(new Date());
  const holidays = await getHolidaySet();
  await importKitBranches(log);
  // Alicia-Inactive was still open when its loan was opened; MyLoans closes it below (Branch review).
  await prisma.branch.update({ where: { code: "718" }, data: { active: true, deactivatedAt: null, deactivatedById: null } });
  const u = await createAccounts(log);
  await sourceRecords(today, holidays);
  await setSetting("email.active", false);
  await setSetting("samples.showDataCheck", false);
  await setSetting("myloans.simulateUnavailable", false);

  // ---- helpers (each one is the same call a screen makes) ----
  const loan = (pn: string) => prisma.loan.findUniqueOrThrow({ where: { pn } });
  const txn = (pn: string, code: string) => prisma.loanTransaction.findFirstOrThrow({ where: { loan: { pn }, type: { code } }, include: { checks: { include: { rule: true }, orderBy: { createdAt: "asc" } } } });
  /** The branch's usual LTO office (Settings, Branches), as the Send panel pre-selects it. */
  const office = async (pn: string) => {
    const l = await prisma.loan.findUniqueOrThrow({ where: { pn }, include: { branch: true } });
    return l.branch.usualLtoOfficeId ?? (await prisma.ltoOffice.findFirstOrThrow({ where: { active: true, code: "LTO-QC" } })).id;
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
  const fundsType = async (code: "CA" | "FT") => prisma.fundsType.findUniqueOrThrow({ where: { code } });
  /** Request (Cash advance, or Fund transfer when `ft`), approve, release (a transfer with its reference, date and account ending). */
  const fund = async (pn: string, dp: CurrentUser, upTo: "requested" | "approved" | "released", ft = false) => {
    const t = await txn(pn, "MORTGAGE");
    const r = await requestAdvance(dp, { lines: [{ transactionId: t.id, kind: "LTO_FEE", cents: 350_000 }], fundsTypeId: (await fundsType(ft ? "FT" : "CA")).id });
    if (upTo !== "requested") await decideAdvance(u.finance, r.id, { approve: true });
    if (upTo === "released") {
      await releaseAdvance(u.finance, r.id, ft
        ? { ref: `FT-88${pn.slice(-4)}`, transferDate: today, accountProvider: "BPI", accountName: dp.name, accountLast4: dp.name === "DP 1" ? "4821" : "7350" }
        : { ref: `CV-${pn.slice(-4)}` });
    }
    return { advanceId: r.id, lineId: (await prisma.cashAdvanceLine.findFirstOrThrow({ where: { advanceId: r.id } })).id };
  };
  /** The one date set directly: the liquidation was due 2 business days ago. */
  const pastDue = (advanceId: string) => prisma.cashAdvance.update({ where: { id: advanceId }, data: { liquidationDueAt: new Date(`${shiftBusinessDays(today, -2, holidays)}T17:00:00+08:00`) } });

  // ---- open every loan that is opened in the DMS ----
  for (const l of KIT_LOANS.filter((x) => x.opened)) await open(l);
  log(`Opened ${KIT_LOANS.filter((x) => x.opened).length} loan files (Find loan, Open Loan File).`);

  const cases: Record<string, () => Promise<unknown>> = {
    // Loan Associate
    "GD1012026902011": () => tick(u.la1, "GD1012026902011", "MORTGAGE"),
    "GD1012026902012": async () => {
      const t = await txn("GD1012026902012", "NOTARY");
      const missing = t.checks.find((c) => c.required)!;
      await tick(u.la1, "GD1012026902012", "NOTARY", [missing.id]);
      await requestMissingDocuments(u.la1, { transactionId: t.id, checkIds: [missing.id], askedFrom: "BORROWER", note: "The borrower brings it on Monday." });
    },
    "GD1012026902013": async () => {
      await raiseHold(u.la1, { transactionId: (await txn("GD1012026902013", "NOTARY")).id, reasonId: await reason.hold("CLIENT-PAPERS"), note: "Waiting for the signed deed of sale from the borrower." });
      await raiseHold(u.la2, { transactionId: (await txn("GD1012026902013", "PPSR")).id, reasonId: await reason.hold("BRANCH-HEAD"), note: "Branch head to approve the PPSR fee first." });
    },
    "GD1012026902014": () => send("GD1012026902014", "NOTARY", u.dp1),
    "GD1012026902015": () => send("GD1012026902015", "NOTARY", u.dp1),
    "GD1012026902016": () => send("GD1012026902016", "NOTARY", u.dp2),
    "GD1012026902017": async () => {
      const { t, job } = await accepted("GD1012026902017", "NOTARY", u.dp1);
      const id = t.checks.find((c) => c.required && /ID/i.test(c.rule?.label ?? ""))?.id ?? t.checks.find((c) => c.required)!.id;
      await returnToLa(u.dp1, job.id, { reasonId: await reason.ret("MISSING"), checkIds: [id], note: "The ID copy is unreadable. Bring a clear copy.", handedOver: await papers(t.id) });
    },
    "GD1012026902018": async () => {
      const { t, job } = await accepted("GD1012026902018", "NOTARY", u.dp1);
      await returnToLa(u.dp1, job.id, { reasonId: await reason.ret("OTHER"), note: "The deed of sale must be signed on every page.", handedOver: await papers(t.id) });
      await confirmPapersBack(u.la1, { transactionId: t.id, notReceived: [] });
      await send("GD1012026902018", "NOTARY", u.dp1); // round 2, waiting for DP 1
    },
    "GD1012026902019": async () => {
      const { job } = await send("GD1012026902019", "NOTARY", u.dp1, { by: u.laInactive });
      await declineJob(u.dp1, job.id, { reasons: ["Wrong job for me"], remarks: "This one is for the Angono processor." });
      await setRowActive(u.admin, "user", u.laInactive.id, false); // the sender has since left
    },
    // DP stages
    "GD1012026902020": async () => { const { job } = await accepted("GD1012026902020", "NOTARY", u.dp1); await work(u.dp1, job.id, 1); },
    "GD1012026902021": async () => { const { job } = await accepted("GD1012026902021", "PPSR", u.dp1); await work(u.dp1, job.id, 1); },
    "GD1012026902022": async () => { const { job } = await accepted("GD1012026902022", "MORTGAGE", u.dp1); await work(u.dp1, job.id, 1); },
    "GD1012026902023": async () => {
      const { job } = await accepted("GD1012026902023", "NOTARY", u.dp1);
      await work(u.dp1, job.id, "VERIFY");
      const a = await loadAssignment(prisma, job.id);
      const v = (await stageRows(prisma, a)).find((r) => r.kind === "VERIFY")!;
      await startStage(u.dp1, job.id, v.id ?? v.code);
      const vid = (await stageRows(prisma, await loadAssignment(prisma, job.id))).find((r) => r.kind === "VERIFY")!.id!;
      const docs = verifiablePapers(a.transaction.documents);
      await verifyPaper(u.dp1, job.id, vid, docs[0].id);
      await somethingMissing(u.dp1, job.id, vid, [docs[1].id], "Not in the folder that came back from the notary.");
    },
    "GD1012026902024": async () => { await accepted("GD1012026902024", "MORTGAGE", u.dp1, ["LTO_FEE"]); await fund("GD1012026902024", u.dp1, "released"); },
    "GD1012026902025": async () => {
      const { t } = await accepted("GD1012026902025", "NOTARY", u.dp1);
      await raiseHold(u.dp1, { transactionId: t.id, reasonId: await reason.hold("CLIENT-DECISION"), note: "The borrower is deciding whether to add a co-maker." });
    },
    "GD1012026902026": async () => {
      const { t } = await accepted("GD1012026902026", "NOTARY", u.dp1);
      await raiseProblem(u.dp1, { transactionId: t.id, reasonId: await reason.problem("LTO_DOWN"), note: "LTO system down the whole morning." });
    },
    "GD1012026902027": async () => {
      const { job } = await accepted("GD1012026902027", "NOTARY", u.dp1);
      await work(u.dp1, job.id, "ALL");
      await completeJob(u.dp1, job.id, {});
      await forwardJob(u.dp1, job.id, { branchId: (await prisma.branch.findUniqueOrThrow({ where: { code: "168" } })).id, receivingLaId: u.laMabini.id, note: "The borrower collects at A. Mabini." });
    },
    "GD1012026902028": async () => {
      const e = await tick(u.la1, "GD1012026902028", "EDST");
      await recordEdst(u.la1, { transactionId: e.id, reference: "EDST-2028" });
      const { job } = await accepted("GD1012026902028", "NOTARY", u.dp1);
      await work(u.dp1, job.id, "ALL");
      await completeJob(u.dp1, job.id, {});
      await forwardJob(u.dp1, job.id, { branchId: (await loan("GD1012026902028")).branchId, receivingLaId: u.la1.id });
      await receivePackage(u.la1, job.id, { result: "complete", note: "" });
    },
    "GD1012026902029": async () => {
      const { job } = await accepted("GD1012026902029", "NOTARY", u.dp1);
      await work(u.dp1, job.id, "ALL");
      await completeJob(u.dp1, job.id, {});
      await forwardJob(u.dp1, job.id, { branchId: (await loan("GD1012026902029")).branchId, receivingLaId: u.la1.id });
      await receivePackage(u.la1, job.id, { result: "incomplete", note: "The notarized deed of sale is missing from the package." });
    },
    // Funds
    "GD1012026902030": () => accepted("GD1012026902030", "MORTGAGE", u.dp1, ["LTO_FEE"]),
    "GD1012026902031": async () => { await accepted("GD1012026902031", "MORTGAGE", u.dp1, ["LTO_FEE"]); await fund("GD1012026902031", u.dp1, "requested"); },
    "GD1012026902032": async () => { await accepted("GD1012026902032", "MORTGAGE", u.dp1, ["LTO_FEE"]); await fund("GD1012026902032", u.dp1, "approved"); },
    "GD1012026902033": async () => { await accepted("GD1012026902033", "MORTGAGE", u.dp2, ["LTO_FEE"]); await fund("GD1012026902033", u.dp2, "released"); },
    "GD1012026902035": async () => {
      await accepted("GD1012026902035", "MORTGAGE", u.dp2, ["LTO_FEE"]);
      const { lineId } = await fund("GD1012026902035", u.dp2, "released");
      await addReceipt(u.dp2, { lineId, date: today, cents: 350_000, number: "OR-2035" }, null);
    },
    "GD1012026902036": async () => {
      await accepted("GD1012026902036", "MORTGAGE", u.dp2, ["LTO_FEE"]);
      const { advanceId, lineId } = await fund("GD1012026902036", u.dp2, "released");
      await addReceipt(u.dp2, { lineId, date: today, cents: 350_000, number: "OR-2036" }, null);
      await closeAdvance(u.finance, advanceId);
    },
    "GD1012026902037": async () => {
      const { t, job } = await accepted("GD1012026902037", "MORTGAGE", u.dp2, ["LTO_FEE"]);
      await fund("GD1012026902037", u.dp2, "released");
      await returnToLa(u.dp2, job.id, { reasonId: await reason.ret("OTHER-TXN"), note: "Needs the PPSR entry done first.", handedOver: await papers(t.id) });
    },
    // TAT: papers ticked, ready to send
    "GD1012026902038": () => tick(u.la1, "GD1012026902038", "NOTARY"),
    "GD1012026902039": () => tick(u.la1, "GD1012026902039", "NOTARY"),
    "GD1012026902040": () => tick(u.la1, "GD1012026902040", "NOTARY"),
    // MyLoans changes (the simulator in Settings, as Admin)
    "GD1012026902041": async () => simulateSourceChange(u.admin, (await loan("GD1012026902041")).id, "name"),
    "GD1012026902042": async () => simulateSourceChange(u.admin, (await loan("GD1012026902042")).id, "amount"),
    "GD1012026902043": async () => simulateSourceChange(u.admin, (await loan("GD1012026902043")).id, "cancel"),
    "GD1012026902044": async () => simulateSourceChange(u.admin, (await loan("GD1012026902044")).id, "replace"),
    // Branches: MyLoans moved a loan to another branch (waiting; and applied by Admin).
    "GD1012026902071": async () => simulateSourceChange(u.admin, (await loan("GD1012026902071")).id, "branch"),
    "GD1012026902072": async () => {
      const l = await loan("GD1012026902072");
      await simulateSourceChange(u.admin, l.id, "branch");
      const item = await prisma.sourceChange.findFirstOrThrow({ where: { loanId: l.id, state: "OPEN" } });
      await applySourceChange(u.admin, item.id, { note: "The borrower now pays at Angono; MyLoans moved the account." });
    },
    // Last: an overdue advance blocks the processor's next request (as it should), so it comes after the others.
    // Fund transfers, in the same states (DP 1 and DP 2).
    "GD1012026902051": async () => { await accepted("GD1012026902051", "MORTGAGE", u.dp1, ["LTO_FEE"]); await fund("GD1012026902051", u.dp1, "requested", true); },
    "GD1012026902052": async () => {
      // Asked as a Cash advance; Finance changed it to a Fund transfer (with remarks) before approving.
      await accepted("GD1012026902052", "MORTGAGE", u.dp1, ["LTO_FEE"]);
      const { advanceId } = await fund("GD1012026902052", u.dp1, "requested");
      await changeFundsType(u.finance, advanceId, { fundsTypeId: (await fundsType("FT")).id, remarks: "DP 1 is at the LTO all week: send it to the account instead of cash." });
      await decideAdvance(u.finance, advanceId, { approve: true });
    },
    "GD1012026902053": async () => { await accepted("GD1012026902053", "MORTGAGE", u.dp1, ["LTO_FEE"]); await fund("GD1012026902053", u.dp1, "released", true); },
    "GD1012026902054": async () => {
      await accepted("GD1012026902054", "MORTGAGE", u.dp2, ["LTO_FEE"]);
      const { lineId } = await fund("GD1012026902054", u.dp2, "released", true);
      await addReceipt(u.dp2, { lineId, date: today, cents: 350_000, number: "OR-2054" }, null);
    },
    "GD1012026902055": async () => {
      await accepted("GD1012026902055", "MORTGAGE", u.dp2, ["LTO_FEE"]);
      const { advanceId, lineId } = await fund("GD1012026902055", u.dp2, "released", true);
      await addReceipt(u.dp2, { lineId, date: today, cents: 350_000, number: "OR-2055" }, null);
      await closeAdvance(u.finance, advanceId);
    },
    "GD1012026902056": async () => {
      const { t, job } = await accepted("GD1012026902056", "MORTGAGE", u.dp2, ["LTO_FEE"]);
      await fund("GD1012026902056", u.dp2, "released", true);
      await returnToLa(u.dp2, job.id, { reasonId: await reason.ret("OTHER-TXN"), note: "Needs the PPSR entry done first.", handedOver: await papers(t.id) });
    },
    // Last: an overdue record blocks the processor's next request (as it should). Both overdue samples
    // (Cash advance and Fund transfer, DP 2) are released first, then due dates move into the past and
    // the daily overdue check runs.
    "GD1012026902034": async () => {
      await accepted("GD1012026902034", "MORTGAGE", u.dp2, ["LTO_FEE"]);
      await accepted("GD1012026902057", "MORTGAGE", u.dp2, ["LTO_FEE"]);
      const ca = await fund("GD1012026902034", u.dp2, "released");
      const ft = await fund("GD1012026902057", u.dp2, "released", true);
      await pastDue(ca.advanceId);
      await pastDue(ft.advanceId);
      await notifyOverdue();
    },
  };

  // General expenses typed as Other (before any advance is overdue, so DP 1 may still ask).
  for (const o of KIT_OTHER_SAMPLES) await requestAdvance(u.dp1, { others: [{ kind: "OTHER", cents: o.cents, otherDescription: o.description }], fundsTypeId: (await fundsType("CA")).id });
  log(`Added ${KIT_OTHER_SAMPLES.length} sample "Other: Courier" expenses (DP 1, waiting for approval).`);

  for (const [pn, fn] of Object.entries(cases)) {
    try {
      await fn();
    } catch (e) {
      throw new Error(`Sample loan ${pn}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  log(`Prepared ${Object.keys(cases).length} sample cases through the app's own steps.`);
  await buildBranchReview(u, log);
  await buildMonitoring(u, { today, holidays, send, accepted, work, loan, log });
}

/**
 * The Branch review samples, through "Branches from MyLoans" (the sample MyLoans list): a rename and a
 * code change waiting for Admin, and Alicia-Inactive closed by MyLoans and accepted by Admin (it keeps its
 * user and its open loan file).
 */
async function buildBranchReview(u: Users, log: Log) {
  const { rename, code } = KIT_BRANCH_CHANGES;
  await setSetting("myloans.mockBranches", {
    overrides: {
      [String(rename.branchId)]: { name: rename.to, updatedAt: new Date().toISOString() },
      [String(code.branchId)]: { code: code.to, updatedAt: new Date().toISOString() },
      "code:718": { active: false, updatedAt: new Date().toISOString() },
    },
    extra: [],
  });
  const run = await runBranchSync({ trigger: "api", user: u.admin, mode: "full" });
  if (!run?.ok) throw new Error(`Branches from MyLoans: ${run?.message ?? "did not run"}`);
  const closed = await prisma.branchReview.findFirst({ where: { state: "OPEN", kind: { in: ["CLOSED", "NOT_IN_LIST"] }, code: "718" } });
  if (closed) await acceptReview(u.admin, closed.id);
  const open = await prisma.branchReview.count({ where: { state: "OPEN" } });
  log(`Branches from MyLoans: ${run.message} Alicia-Inactive closed (accepted); ${open} item${open === 1 ? "" : "s"} wait in the Branch review.`);
}

/** n business days before today at a time of day (PHT); today: a few minutes ago. */
function daysAgo(today: string, holidays: ReadonlySet<string>, n: number, hhmm: string): Date {
  if (n === 0) return new Date(Date.now() - 10 * 60_000);
  return new Date(`${shiftBusinessDays(today, -n, holidays)}T${hhmm}:00+08:00`);
}

/**
 * Monitoring samples. Every job goes through the app's own steps (send, accept, stages, complete,
 * forward, receive; capacity and leave through Settings, Processor capacity; advisories through the
 * real filing and resolving). Then, as with the overdue advance, the times are moved into the past
 * directly so the averages differ (a job made in one minute would show 0 days everywhere).
 */
async function buildMonitoring(
  u: Users,
  h: {
    today: string; holidays: ReadonlySet<string>; log: Log;
    send: (pn: string, code: string, dp: CurrentUser, o?: { by?: CurrentUser; funds?: string[]; tick?: boolean }) => Promise<{ t: { id: string }; job: { id: string } }>;
    accepted: (pn: string, code: string, dp: CurrentUser, funds?: string[]) => Promise<{ t: { id: string }; job: { id: string } }>;
    work: (dp: CurrentUser, jobId: string, stop: number | "VERIFY" | "ALL") => Promise<void>;
    loan: (pn: string) => Promise<{ branchId: string }>;
  },
) {
  const { today, holidays } = h;
  const at = (n: number, hhmm = "10:00") => daysAgo(today, holidays, n, hhmm);
  /** Moves a job's times: sent, accepted, and each stage (kind: days ago when it finished). */
  const backdate = async (jobId: string, plan: { sent: number; accepted?: number; stages?: Partial<Record<"OWN" | "LTO_DROP" | "LTO_PICKUP" | "VERIFY", number>> }) => {
    const a = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: jobId }, include: { transaction: true } });
    const sent = at(plan.sent, "09:00");
    const acc = plan.accepted !== undefined ? at(plan.accepted, "09:30") : null;
    await prisma.dpAssignment.update({ where: { id: jobId }, data: { endorsedAt: sent, createdAt: sent, ...(acc ? { decidedAt: acc, labelsConfirmedAt: acc } : {}) } });
    if (a.transaction.status === "ASSIGNED") await prisma.loanTransaction.update({ where: { id: a.transactionId }, data: { statusSince: sent } });
    if (a.transaction.status === "IN_PROCESS" && acc) await prisma.loanTransaction.update({ where: { id: a.transactionId }, data: { statusSince: acc } });
    for (const [kind, n] of Object.entries(plan.stages ?? {})) {
      const done = at(n!, kind === "VERIFY" ? "16:00" : kind === "LTO_PICKUP" ? "14:00" : kind === "LTO_DROP" ? "11:00" : "10:00");
      await prisma.jobStage.updateMany({ where: { assignmentId: jobId, kind: kind as "OWN" }, data: { startedAt: new Date(done.getTime() - 30 * 60_000), finishedAt: done } });
    }
  };
  /** Sent by the branch's LA and accepted by the processor. */
  const acceptedBy = async (pn: string, dp: CurrentUser, la: CurrentUser) => {
    const { job } = await h.send(pn, "NOTARY", dp, { by: la });
    await acceptJob(dp, job.id, true);
    return { job };
  };
  const finish = async (pn: string, dp: CurrentUser, la: CurrentUser) => {
    const { job } = await acceptedBy(pn, dp, la);
    await h.work(dp, job.id, "ALL");
    await completeJob(dp, job.id, {});
    await forwardJob(dp, job.id, { branchId: (await h.loan(pn)).branchId, receivingLaId: la.id });
    await receivePackage(la, job.id, { result: "complete", note: "" });
    return job.id;
  };

  // Offices: the distance and suggested transport, through Settings, LTO offices.
  for (const [code, km, hours, transport] of [["LTO-QC", 8, 1, 400], ["LTO-MKT", 12, 1.5, 600]] as const) {
    const o = await prisma.ltoOffice.findUniqueOrThrow({ where: { code } });
    await saveSettingsRow(u.admin, "ltoOffice", o.id, { code: o.code, name: o.name, city: o.city, distanceKm: String(km), travelHours: String(hours), suggestedTransport: String(transport) });
  }

  const steps: Record<string, () => Promise<unknown>> = {
    "GD1012026902060": async () => backdate(await finish("GD1012026902060", u.dp2, u.la1), { sent: 6, accepted: 5, stages: { OWN: 5, LTO_DROP: 4, LTO_PICKUP: 2, VERIFY: 1 } }),
    "GD1012026902061": async () => backdate(await finish("GD1012026902061", u.dp2, u.la1), { sent: 2, accepted: 2, stages: { OWN: 2, LTO_DROP: 2, LTO_PICKUP: 1, VERIFY: 1 } }),
    "GD1682026902062": async () => backdate(await finish("GD1682026902062", u.dp4, u.laMabini), { sent: 4, accepted: 3, stages: { OWN: 3, LTO_DROP: 3, LTO_PICKUP: 1, VERIFY: 0 } }),
    "GD1682026902063": async () => { const { job } = await h.send("GD1682026902063", "NOTARY", u.dp4, { by: u.laMabini }); await backdate(job.id, { sent: 3 }); },
    "GD1682026902064": async () => {
      const { job } = await acceptedBy("GD1682026902064", u.dp4, u.laMabini);
      await h.work(u.dp4, job.id, 2); // Notarization, then LTO drop off: now at LTO Makati
      await backdate(job.id, { sent: 3, accepted: 2, stages: { OWN: 2, LTO_DROP: 1 } });
    },
    "GD3902026902065": async () => { const { job } = await h.send("GD3902026902065", "NOTARY", u.dp3, { by: u.laAlaminos }); await backdate(job.id, { sent: 1 }); },
  };
  for (const [pn, fn] of Object.entries(steps)) {
    try { await fn(); } catch (e) { throw new Error(`Sample loan ${pn}: ${e instanceof Error ? e.message : String(e)}`); }
  }

  // Capacity and leave (Settings, Processor capacity): DP 4 takes 5 open jobs; DP 3 is on leave for a week.
  await saveDpCapacity(u.admin, u.dp4.id, { capacity: "5", onLeave: false, leaveUntil: "" });
  await saveDpCapacity(u.admin, u.dp3.id, { capacity: "", onLeave: true, leaveUntil: shiftBusinessDays(today, 5, holidays) });

  // Three advisories: active (2 hours ago), resolved, and one older than 24 hours.
  const job = async (pn: string) => prisma.dpAssignment.findFirstOrThrow({ where: { loan: { pn }, transaction: { type: { code: { in: ["NOTARY", "MORTGAGE"] } } } }, orderBy: { createdAt: "desc" } });
  const qc = await fileAdvisory(u.dp1, { assignmentId: (await job("GD1012026902022")).id, type: "SYSTEM_DOWN", remarks: "The LTMS terminals are offline; the guard says maybe after lunch." });
  await prisma.ltoAdvisory.update({ where: { id: qc.id }, data: { startedAt: new Date(Date.now() - 2 * 3_600_000), createdAt: new Date(Date.now() - 2 * 3_600_000) } });
  const mkt = await fileAdvisory(u.dp4, { assignmentId: (await job("GD1682026902064")).id, type: "OFFICE_CLOSED", remarks: "Closed for the morning: staff seminar." });
  await prisma.ltoAdvisory.update({ where: { id: mkt.id }, data: { startedAt: at(1, "08:00"), createdAt: at(1, "08:05") } });
  await resolveAdvisory(u.monitor, mkt.id, { remarks: "Open again from 1 PM, confirmed by phone." });
  const ceb = await prisma.ltoOffice.findUniqueOrThrow({ where: { code: "LTO-CEB" } });
  const old = await fileAdvisory(u.monitor, { ltoOfficeId: ceb.id, type: "LONG_QUEUE", remarks: "Queue past the gate every morning this week; go before 7 AM." });
  await prisma.ltoAdvisory.update({ where: { id: old.id }, data: { startedAt: at(2, "07:30"), createdAt: at(2, "07:35") } });
  h.log("Prepared the Monitoring samples: finished jobs, an overdue job, a job at the LTO, capacity and leave, three LTO advisories.");
}
