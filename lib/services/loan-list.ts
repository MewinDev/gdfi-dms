import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { branchRowScope, can, inScope, loanScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getTatMap } from "@/lib/settings";
import { getCalendar } from "@/lib/calendar/load";
import { daysFor, type Days } from "@/lib/calendar/core";
import { loanTat } from "@/lib/workflow/tat";
import { nextStepFor, ownerTooltip } from "@/lib/workflow/stage-map";
import { businessDate, tatBadge } from "@/lib/time";
import { dayText, deadlineChip, LA_STAGES, peso, type Tone } from "@/lib/ui/plain";
import { BORROWER_CHIP } from "@/lib/ui/borrower-chip";
import { cleanPn, getPnFormat, isPnAttempt, parsePn, pnHeadline } from "@/lib/pn";
import { pageInfo, type PageInfo } from "@/lib/ui/paging";
import { facetCounts, passes, sortRows, type FacetCounts, type LeanRow, type LoanListParams } from "@/lib/ui/loan-list";
import { completePn } from "./find-local";
import { lookupPn, type PnLookupResult } from "./loan-file";
import { logPnSearch } from "./pn-search-log";

/**
 * D-059: the one Loans page (every role; what each sees is their permissions and branch access). Three sources:
 *   1  loan files in the DMS (branch scope in the query)
 *   2  released loans not yet in the DMS: the open "Released, not yet in the DMS" items of the branch pools
 *   3  only in myloans: a full, valid PN with no match in 1 or 2 is looked up in myloans (API 1) once and logged;
 *      a name or part of a PN never goes to myloans
 * Everything runs on the server: one lean query of the matching open loan files (only the columns the filters, the
 * counts and the order need), the TAT of each on its branch calendar (D-041), the counts, the order and the page;
 * then the full details for the 25 or 50 rows of the page only.
 */

const OPEN = ["POOL", "INBOX", "HELD"];

export interface LoanListItem {
  key: string;
  source: "dms" | "pool";
  pn: string;
  borrowerName: string;
  branchName: string;
  productName: string;
  loanType: string;
  classification: "Financing" | "Refinancing" | "";
  releasedText: string;
  /** The release date alone ("Nov 24, 2026"), for the Released on column. */
  releasedOn: string;
  amountText: string | null;
  /** The one Status / next step text ("Check documents, then assign to DP", "On hold: …", "Cancelled in myloans"). */
  statusText: string;
  /** A chip before the text for what stands out ("Not yet in DMS", "On hold", "Cancelled"), else null. */
  statusChip: { text: string; tone: Tone | "hold" } | null;
  statusTip?: string;
  /** "Something is different": MyLoans changed, borrower details waiting, problems. */
  flags: { text: string; tone: Tone }[];
  /** A person's name, "Branch pool", or "-". */
  withText: string;
  due: { text: string; tone: Tone; hot: boolean } | null;
  deadline: string | null;
  /** D-060: the one action, View details: the loan file, or the preview of a loan not yet in the DMS. */
  viewHref: string;
  /** D-060: a released loan not yet in the DMS (the "myloans · Not yet in DMS" badge). */
  notInDms: boolean;
}

export interface LoanListResult {
  rows: LoanListItem[];
  info: PageInfo;
  counts: FacetCounts;
  branches: { id: string; name: string }[];
  seesAmounts: boolean;
  /** Source 3: what myloans said about a full PN that is not in the DMS or the pools. */
  myloans: PnLookupResult | null;
  /** Text that looks like a PN but is not a valid one (and matched nothing): the PN check's message. */
  badPn: { headline: string; message: string } | null;
  /** A full PN that is a loan file here: the page asks for the background refresh (as the old "Already in the DMS" card). */
  refreshPn: string | null;
}

/** LIKE text: the wildcards in what was typed are matched as themselves. */
const like = (v: string) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The search: part of a PN (as typed or without spaces and dashes), part of the name, the CIN or CIF, a paper's Document ID, a branch code. */
function searchSql(q: string): Prisma.Sql {
  if (!q) return Prisma.sql`TRUE`;
  const pnText = cleanPn(q) || q;
  const ids = [...new Set([q, q.toUpperCase()])];
  return Prisma.sql`(l.pn ILIKE ${like(pnText)} OR l."borrowerName" ILIKE ${like(q)} OR l.cin = ANY(${ids}) OR l.cif = ANY(${ids})
    OR EXISTS (SELECT 1 FROM "DocumentItem" d WHERE d."loanId" = l.id AND d."documentId" = ANY(${ids}))
    ${/^\d{3}$/.test(q) ? Prisma.sql`OR b.code = ${q}` : Prisma.empty})`;
}

/** The same search for the archived count (Prisma). */
function searchWhere(q: string): Prisma.LoanWhereInput {
  if (!q) return {};
  const pnText = cleanPn(q) || q;
  const ids = [...new Set([q, q.toUpperCase()])];
  return {
    OR: [
      { pn: { contains: pnText, mode: "insensitive" } },
      { borrowerName: { contains: q, mode: "insensitive" } },
      { cin: { in: ids } },
      { cif: { in: ids } },
      { documents: { some: { documentId: { in: ids } } } },
      ...(/^\d{3}$/.test(q) ? [{ branch: { code: q } }] : []),
    ],
  };
}

interface LeanSql {
  id: string; pn: string; borrowerName: string; branchId: string; stage: string; since: string; released: string; amount: number;
  openedById: string; sourceHold: boolean; archived: boolean; exc: number; probs: number; held: boolean; codes: string[] | null;
  holder: string | null; pool: boolean;
}

/**
 * One query for every matching loan file, with only what the filters, the counts and the order need. The open
 * problems, holds, jobs in process and work items are joined as small grouped sets (open work only), and the dates
 * come as Philippine YYYY-MM-DD, so the whole list loads in one round trip.
 */
function leanLoans(scopeIds: string[] | null, q: string, withArchived: boolean) {
  return prisma.$queryRaw<LeanSql[]>`
    WITH ex AS (SELECT "loanId", count(*)::int AS n FROM "LoanException" WHERE status = 'OPEN' GROUP BY 1),
         pr AS (SELECT "loanId", count(*)::int AS n FROM "Problem" WHERE "resolvedAt" IS NULL GROUP BY 1),
         ho AS (SELECT DISTINCT "loanId" FROM "Hold" WHERE "resumedAt" IS NULL),
         ip AS (SELECT t."loanId", array_agg(tt.code) AS codes FROM "LoanTransaction" t JOIN "TransactionType" tt ON tt.id = t."typeId"
                WHERE t.status = 'IN_PROCESS' GROUP BY 1),
         wh AS (SELECT DISTINCT ON ("loanId") "loanId", "holderUserId" FROM "WorkItem"
                WHERE state IN ('INBOX', 'HELD') AND "holderUserId" IS NOT NULL AND "loanId" IS NOT NULL AND kind IN ('TRANSACTION', 'DP_JOB')
                ORDER BY "loanId", "arrivedAt" DESC),
         wp AS (SELECT DISTINCT "loanId" FROM "WorkItem" WHERE state = 'POOL' AND "loanId" IS NOT NULL AND kind IN ('TRANSACTION', 'DP_JOB'))
    SELECT l.id, l.pn, l."borrowerName", l."branchId", l.stage,
           to_char(l."stageSince" AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS since,
           to_char(l."releasedAt" AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS released,
           l."totalReleasedAmount"::float8 AS amount, l."openedById", (l."sourceHold" IS NOT NULL) AS "sourceHold", (l."archivedAt" IS NOT NULL) AS archived,
           COALESCE(ex.n, 0) AS exc, COALESCE(pr.n, 0) AS probs, (ho."loanId" IS NOT NULL) AS held, ip.codes,
           wh."holderUserId" AS holder, (wp."loanId" IS NOT NULL) AS pool
    FROM "Loan" l
    JOIN "Branch" b ON b.id = l."branchId"
    LEFT JOIN ex ON ex."loanId" = l.id
    LEFT JOIN pr ON pr."loanId" = l.id
    LEFT JOIN ho ON ho."loanId" = l.id
    LEFT JOIN ip ON ip."loanId" = l.id
    LEFT JOIN wh ON wh."loanId" = l.id
    LEFT JOIN wp ON wp."loanId" = l.id
    WHERE ${scopeIds ? Prisma.sql`l."branchId" = ANY(${scopeIds})` : Prisma.sql`TRUE`}
      AND ${withArchived ? Prisma.sql`TRUE` : Prisma.sql`l."archivedAt" IS NULL`}
      AND ${searchSql(q)}`;
}

export async function loanListPage(user: CurrentUser, p: LoanListParams, now: Date = new Date()): Promise<LoanListResult> {
  const scope = loanScope(user);
  // Archived loan files are loaded only when asked for (or while searching); otherwise only counted.
  const withArchived = p.status.includes("archived") || (!!p.q && p.status.length === 0);
  const [branchRows, tats, cal, loans, candItems] = await Promise.all([
    prisma.branch.findMany({ where: { hidden: false, ...branchRowScope(user) }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getTatMap(), getCalendar(),
    leanLoans(scope.branchId?.in ?? null, p.q, withArchived),
    prisma.workItem.findMany({ where: { kind: "LOAN_CANDIDATE", state: { in: OPEN }, ...scope }, select: { id: true, subjectId: true, label: true, branchId: true, state: true, holderUserId: true, dueDate: true, arrivedAt: true } }),
  ]);
  const branchName = new Map(branchRows.map((b) => [b.id, b.name]));
  const today = businessDate(now);
  const dayCache = new Map<string, Days>();
  const daysOf = (branchId: string) => { let d = dayCache.get(branchId); if (!d) { d = daysFor(cal, branchId); dayCache.set(branchId, d); } return d; };

  const lean: LeanRow[] = loans.map((l) => {
    const archived = l.archived;
    const tat = archived ? null : loanTat({ stage: l.stage, stageSince: now, releasedAt: now, stageSinceYmd: l.since, releasedYmd: l.released, inProcessCodes: l.codes ?? [] }, tats, daysOf(l.branchId), now);
    // With: the person holding its open work (the latest), else the branch pool, else the Loan Associate who opened it.
    const pool = !l.holder && l.pool;
    return {
      key: l.id, source: "dms", pn: l.pn, borrowerName: l.borrowerName, branchId: l.branchId, branchName: branchName.get(l.branchId) ?? "",
      amount: l.amount, released: l.released, deadline: tat?.deadline ?? null, badge: tat?.badge ?? null,
      needs: !archived && (LA_STAGES.includes(l.stage) || l.exc > 0),
      isNew: false, hold: !archived && (l.held || l.sourceHold), problems: !archived && l.exc + l.probs > 0, archived,
      withId: l.holder ?? (pool ? null : l.openedById), withPool: pool,
    };
  });

  // Source 2: released loans waiting in the branch pools (not yet a loan file here).
  const candPns = [...new Set(candItems.map((c) => c.subjectId))];
  const [cands, already] = candPns.length
    ? await Promise.all([
        prisma.sourceLoanCandidate.findMany({ where: { pn: { in: candPns } }, select: { pn: true, cin: true, borrowerName: true, productName: true, amount: true, releaseDate: true }, orderBy: { lastSeenAt: "desc" } }),
        prisma.loan.findMany({ where: { pn: { in: candPns } }, select: { pn: true } }),
      ])
    : [[], []];
  const candOf = new Map<string, (typeof cands)[number]>();
  for (const c of cands) if (!candOf.has(c.pn)) candOf.set(c.pn, c);
  const inDms = new Set(already.map((l) => l.pn));
  const qLow = p.q.toLowerCase();
  const qPn = (cleanPn(p.q) || p.q).toUpperCase();
  const poolRows = candItems.filter((it) => !inDms.has(it.subjectId)).map((it) => {
    const c = candOf.get(it.subjectId);
    const name = c?.borrowerName ?? it.label.replace(/^[^:]*:\s*/, "");
    return { it, c, name };
  }).filter(({ it, c, name }) => !p.q || it.subjectId.toUpperCase().includes(qPn) || name.toLowerCase().includes(qLow) || (!!c?.cin && c.cin.toUpperCase() === p.q.toUpperCase()));
  for (const { it, c, name } of poolRows) {
    const amount = c?.amount ? Number(c.amount) : NaN;
    lean.push({
      key: `wi:${it.id}`, source: "pool", pn: it.subjectId, borrowerName: name, branchId: it.branchId, branchName: branchName.get(it.branchId) ?? "",
      amount: Number.isFinite(amount) ? amount : null, released: c ? businessDate(c.releaseDate) : businessDate(it.arrivedAt),
      deadline: it.dueDate, badge: it.dueDate ? tatBadge(it.dueDate, today) : null,
      needs: false, isNew: true, hold: false, problems: false, archived: false,
      withId: it.state === "POOL" ? null : it.holderUserId, withPool: it.state === "POOL",
    });
  }

  const counts = facetCounts(lean, p, user.id);
  // Archived and not loaded: counted in the database (with the same search, branch and person).
  if (!withArchived) {
    counts.status.archived = p.late || p.with === "pool" ? 0 : await prisma.loan.count({
      where: { ...scope, ...searchWhere(p.q), archivedAt: { not: null }, ...(p.branch ? { AND: [{ branchId: p.branch }] } : {}), ...(p.with === "me" ? { openedById: user.id } : {}) },
    });
  }
  const shown = sortRows(lean.filter((r) => passes(r, p, user.id)), p.sort, p.dir);
  const info = pageInfo(shown.length, p.page, p.per);
  const page = shown.slice(info.from ? info.from - 1 : 0, info.to);

  // The released amount is part of every loan file its viewer can open (the user's review, 26 November 2026: shown to every role).
  const seesAmounts = true;
  const rows = await details(user, page, poolRows.map((x) => x), seesAmounts, now);

  // Source 3 and the PN check (only for a search).
  let myloans: PnLookupResult | null = null;
  let badPn: LoanListResult["badPn"] = null;
  let refreshPn: string | null = null;
  if (p.q) {
    const pn = await completePn(p.q);
    if (pn) {
      const saved = await prisma.loan.findUnique({ where: { pn }, select: { branchId: true } });
      const pooled = poolRows.find((x) => x.it.subjectId === pn);
      if (saved && inScope(user, saved.branchId)) {
        refreshPn = pn;
        await logPnSearch(user, pn, "FOUND_IN_DMS", { loanBranchId: saved.branchId });
      } else if (can(user, PERMISSIONS.LOANS_SEARCH) && !pooled) {
        // Not here and not in a pool (a pool row's View details opens its preview): one myloans lookup, logged.
        const r = await lookupPn(user, pn);
        myloans = r.kind === "existing" || r.kind === "invalid" ? null : r;
      }
    } else if (shown.length === 0) {
      const fmt = await getPnFormat();
      const parsed = parsePn(p.q, fmt);
      if (!parsed.ok && isPnAttempt(p.q, fmt)) badPn = { headline: pnHeadline(fmt), message: parsed.message };
    }
  }

  return { rows, info, counts, branches: branchRows, seesAmounts, myloans, badPn, refreshPn };
}

/** The full row for each loan of the page (one query for the loan files, one for the people). */
async function details(user: CurrentUser, page: LeanRow[], pool: { it: { id: string; subjectId: string; state: string; holderUserId: string | null; branchId: string }; c?: { productName: string | null } | undefined }[], seesAmounts: boolean, now: Date): Promise<LoanListItem[]> {
  const ids = page.filter((r) => r.source === "dms").map((r) => r.key);
  const [loans, borrower, cal] = await Promise.all([
    ids.length ? prisma.loan.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, productName: true, loanType: true, classification: true, releasedAt: true, stage: true, cancelledAt: true, cancelReason: true, sourceHold: true,
        holds: { where: { resumedAt: null }, select: { reasonName: true, reason: { select: { name: true } } }, orderBy: { raisedAt: "asc" } },
        _count: { select: { exceptions: { where: { status: "OPEN" } }, problems: { where: { resolvedAt: null } }, openItems: { where: { status: "PENDING", audience: "LOAN" } } } },
      },
    }) : Promise.resolve([]),
    ids.length ? prisma.openItem.findMany({ where: { loanId: { in: ids }, status: "PENDING", audience: "BORROWER" }, select: { loanId: true }, distinct: ["loanId"] }) : Promise.resolve([]),
    getCalendar(),
  ]);
  const people = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(page.map((r) => r.withId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const byId = new Map(loans.map((l) => [l.id, l]));
  const changedBorrower = new Set(borrower.map((b) => b.loanId));
  const poolOf = new Map(pool.map((x) => [`wi:${x.it.id}`, x]));

  return page.map((r): LoanListItem => {
    const chip = r.deadline && r.badge ? deadlineChip({ deadline: r.deadline, badge: r.badge }, daysFor(cal, r.branchId), now) : null;
    const due = chip ? { text: chip.text, tone: chip.tone, hot: chip.urgency >= 2 } : null;
    const withText = r.withPool ? "Branch pool" : r.withId ? people.get(r.withId) ?? "-" : "-";
    const amountText = seesAmounts && r.amount !== null ? peso(r.amount) : null;
    if (r.source === "pool") {
      // D-060: no Accept; View details opens the preview, where Open loan file takes it.
      const x = poolOf.get(r.key)!;
      return {
        key: r.key, source: "pool", pn: r.pn, borrowerName: r.borrowerName, branchName: r.branchName, productName: x.c?.productName?.trim() ?? "", loanType: "", classification: "",
        releasedText: `Released ${dayText(r.released)}`, releasedOn: dayText(r.released), amountText,
        statusChip: null,
        statusText: "Released in myloans: view the details to open its loan file",
        flags: [], withText, due, deadline: r.deadline, viewHref: `/loans/preview/${r.pn}`, notInDms: true,
      };
    }
    const l = byId.get(r.key)!;
    const problemN = l._count.exceptions + l._count.problems;
    const holdNames = [...new Set(l.holds.map((h) => h.reasonName || h.reason.name))];
    const next = nextStepFor(l.stage, { hasOpenException: l._count.exceptions > 0 });
    const [statusChip, statusText, statusTip]: [LoanListItem["statusChip"], string, string | undefined] =
      l.cancelledAt ? [{ text: "Cancelled", tone: "mute" }, l.cancelReason?.trim() || "Cancelled in myloans", undefined]
      : r.archived ? [{ text: "Archived", tone: "mute" }, next.label, undefined]
      : holdNames.length ? [{ text: "On hold", tone: "hold" }, `On hold: ${holdNames.join(", ")}`, undefined]
      : l.sourceHold ? [{ text: "On hold", tone: "hold" }, "On hold: myloans says it is no longer released", undefined]
      : problemN ? [null, "Fix a problem first", undefined]
      : [null, next.label, ownerTooltip(next.owner)];
    return {
      key: r.key, source: "dms", pn: r.pn, borrowerName: r.borrowerName, branchName: r.branchName, productName: l.productName?.trim() ?? "",
      loanType: l.loanType?.trim() ?? "", classification: l.classification === "FINANCING" ? "Financing" : l.classification === "REFINANCING" ? "Refinancing" : "",
      releasedText: `Released ${dayText(l.releasedAt)}`, releasedOn: dayText(l.releasedAt), amountText, statusChip, statusText, statusTip,
      flags: [
        ...(l._count.openItems > 0 ? [{ text: "MyLoans changed", tone: "bad" as Tone }] : []),
        ...(changedBorrower.has(l.id) ? [{ text: BORROWER_CHIP, tone: "wait" as Tone }] : []),
        ...(problemN ? [{ text: `${problemN} problem${problemN === 1 ? "" : "s"}`, tone: "bad" as Tone }] : []),
      ],
      withText, due, deadline: r.deadline, viewHref: `/loans/${r.pn}`, notInDms: false,
    };
  });
}
