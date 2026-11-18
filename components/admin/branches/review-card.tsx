import { prisma } from "@/lib/db";
import { fmtShort } from "@/lib/time";
import { REVIEW_KIND_LABEL, type ReviewKind } from "@/lib/branches/diff";
import { reviewNames } from "@/lib/branches/review-name";
import { AlertCard, AlertRow } from "@/components/home/home-ui";
import { BuildingIcon } from "@/components/ui/icons";

/** Admin Home (open items): branch differences from MyLoans waiting for a decision. */
export async function branchReviewToDo() {
  const [count, items, unmatched] = await Promise.all([
    prisma.branchReview.count({ where: { state: "OPEN" } }),
    prisma.branchReview.findMany({ where: { state: "OPEN" }, orderBy: { detectedAt: "desc" }, take: 5 }),
    unmatchedCandidates(),
  ]);
  return { count, items, unmatched, closedWithWork: await closedBranchesWithWork() };
}

/**
 * D-054: branches closed in myloans (made inactive here, or a "Closed" review waiting) that still have open work:
 * their loan files, jobs and inbox items stay fully usable; only new pool items stop. Admin is warned on Home.
 */
export async function closedBranchesWithWork(): Promise<{ name: string; open: number }[]> {
  const closed = await prisma.branch.findMany({ where: { OR: [{ active: false, source: "MYLOANS" }, { reviews: { some: { state: "OPEN", kind: "CLOSED" } } }] }, select: { id: true, name: true } });
  if (!closed.length) return [];
  const open = await prisma.workItem.groupBy({ by: ["branchId"], where: { branchId: { in: closed.map((b) => b.id) }, state: { not: "DONE" } }, _count: { _all: true } });
  return closed.map((b) => ({ name: b.name, open: open.find((o) => o.branchId === b.id)?._count._all ?? 0 })).filter((b) => b.open > 0);
}

/**
 * 10b (D-053, D-054): released loans not yet in the DMS whose myloans BranchID is no DMS branch: they cannot enter a
 * branch pool until the branch is accepted in the Branch review.
 */
export async function unmatchedCandidates(): Promise<number> {
  // D-054: by myloans' BranchID; the code only for a candidate without one.
  const branches = await prisma.branch.findMany({ select: { code: true, myloansBranchId: true } });
  const ids = branches.map((b) => b.myloansBranchId).filter((x): x is number => x !== null);
  const codes = branches.map((b) => b.code).filter((x): x is string => !!x);
  return prisma.sourceLoanCandidate.count({ where: { OR: [
    { myloansBranchId: { not: null, notIn: ids } },
    { myloansBranchId: null, OR: [{ branchCode: null }, { branchCode: { notIn: codes } }] },
  ] } });
}

/** Hidden when none. The branch name only (the code stays on the Branch review page); the code in grey only when two names match. */
export function BranchReviewCard({ data }: { data: Awaited<ReturnType<typeof branchReviewToDo>> }) {
  if (!data.count && !data.closedWithWork.length) return null;
  const names = reviewNames(data.items);
  const href = "/admin/settings?open=branches&step=review";
  return (
    <AlertCard id="brv-h" title="Branch review" count={data.count} tone="act" icon={<BuildingIcon size={15} />}
      reason={<>MyLoans has branches that differ from the DMS.{data.closedWithWork.map((b) => <strong key={b.name} className="block text-bad-fg" data-closed-branch-work> Branch {b.name} is closed in myloans but has {b.open} open item{b.open === 1 ? "" : "s"}.</strong>)}{data.unmatched > 0 && <strong className="text-bad-fg" data-unmatched-candidates> {data.unmatched} released loan{data.unmatched === 1 ? "" : "s"} not yet in the DMS wait{data.unmatched === 1 ? "s" : ""} for a branch: {data.unmatched === 1 ? "it reaches" : "they reach"} the branch pool once the branch is accepted.</strong>}</>}
      link={{ href, label: "Open the Branch review" }} data={{ "data-branch-review-card": "" }} countData={{ "data-branch-review-count": "" }}>
      <ul>
        {data.items.map((i, n) => (
          <AlertRow key={i.id} href={href}>
            <span className="min-w-0 flex-1 truncate font-semibold text-navy" data-review-name>
              {names[n].name}{names[n].code && <span className="ml-1.5 font-normal text-ink-2">{names[n].code}</span>}
            </span>
            <span className="chip c-act h-6 text-xs">{REVIEW_KIND_LABEL[i.kind as ReviewKind]}</span>
            <span className="basis-full text-[12px] text-ink-2 sm:basis-auto">{fmtShort(i.detectedAt)}</span>
          </AlertRow>
        ))}
      </ul>
    </AlertCard>
  );
}
