import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtShort } from "@/lib/time";
import { REVIEW_KIND_LABEL, type ReviewKind } from "@/lib/branches/diff";
import { BuildingIcon } from "@/components/ui/icons";
import { reviewNames } from "@/lib/branches/review-name";

/** Admin Home (open items): branch differences from MyLoans waiting for a decision. Hidden when none. */
export async function BranchReviewCard() {
  const [count, items] = await Promise.all([
    prisma.branchReview.count({ where: { state: "OPEN" } }),
    prisma.branchReview.findMany({ where: { state: "OPEN" }, orderBy: { detectedAt: "desc" }, take: 5 }),
  ]);
  if (!count) return null;
  // The branch name only (the code stays on the Branch review page); the code in grey only when two names match.
  const names = reviewNames(items);
  return (
    <section aria-labelledby="brv-h" className="card overflow-hidden border-2 border-act-fg/40" data-branch-review-card>
      <div className="flex items-center gap-3 px-4 pb-2 pt-4 sm:px-6">
        <span className="text-act-fg"><BuildingIcon size={22} /></span>
        <h2 id="brv-h" className="flex-1 text-lg font-bold text-navy">Branch review</h2>
        <span className="text-[28px] font-bold leading-none text-act-fg" data-branch-review-count>{count}</span>
      </div>
      <ul className="border-t border-line">
        {items.map((i, n) => (
          <li key={i.id} className="border-b border-line-soft last:border-0">
            <Link href="/admin/settings?open=branches&step=review" className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5 no-underline hover:bg-fill sm:px-6">
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-navy" data-review-name>
                {names[n].name}{names[n].code && <span className="ml-1.5 font-normal text-ink-2">{names[n].code}</span>}
              </span>
              <span className="chip c-act h-6 text-xs">{REVIEW_KIND_LABEL[i.kind as ReviewKind]}</span>
              <span className="basis-full text-[12px] text-ink-2 sm:basis-auto">{fmtShort(i.detectedAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/admin/settings?open=branches&step=review" className="link block px-4 py-3 text-sm sm:px-6">Open the Branch review</Link>
    </section>
  );
}
