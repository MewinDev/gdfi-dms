import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { inScope, requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { loadAssignment, mayReceive } from "@/lib/services/jobs";
import { getHolidaySet, getTatMap } from "@/lib/settings";
import { txnTat } from "@/lib/jobs/view";
import { dayText, txnName } from "@/lib/ui/plain";
import { PageTop } from "@/components/loan/page-top";
import { Banner } from "@/components/ui/basics";
import { TatChip } from "@/components/jobs/chips";
import { ReceivePackageForm } from "@/components/jobs/forms";

export const metadata: Metadata = { title: "Receive package" };

/**
 * Receive a forwarded package. For the named LA in the branch the DP chose, even when the loan
 * belongs to another branch: this page shows the package and the receive step only, nothing else
 * of the loan file.
 */
export default async function ReceivePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.RETURNS_ACCEPT);
  const { id } = await params;
  const a = await loadAssignment(prisma, id).catch(() => null);
  if (!a || !(mayReceive(user, a) || a.receivingLaId === user.id)) notFound();
  const [t, tats, holidays] = await Promise.all([
    prisma.loanTransaction.findUniqueOrThrow({ where: { id: a.transactionId }, include: { type: true, problems: { include: { reason: true } }, holds: { include: { reason: true } }, advanceLines: { include: { advance: true } }, documents: { where: { documentId: { not: null } }, orderBy: { createdAt: "asc" } } } }),
    getTatMap(),
    getHolidaySet(),
  ]);
  const waiting = t.status === "FORWARDED" && mayReceive(user, a);
  const papers = t.documents.filter((d) => d.stage === "IN_TRANSIT");
  return (
    <div className="dense flex w-full flex-col gap-4">
      <PageTop
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Receive package" }]}
        back={{ label: "Home", href: "/dashboard" }}
        title={`Receive: ${txnName(t.type.code, t.type.name)}`}
        subtitle={`${a.loan.borrowerName} · ${a.loan.pn} · to ${a.receivingBranch?.name ?? a.loan.branch.name}`}
        right={waiting ? <TatChip data={txnTat(t, tats, holidays)} /> : null}
      />
      {waiting ? (
        <section aria-labelledby="pkg-h" className="card flex flex-col gap-3 p-4 sm:p-5" data-receive-page>
          <h2 id="pkg-h" className="text-lg font-bold text-navy">Package from {a.dpUser.name}</h2>
          <p className="text-[15px] text-ink-2">Forwarded {dayText(a.forwardedAt)} to {a.receivingLa?.name ?? "you"} at {a.receivingBranch?.name ?? a.loan.branch.name}. The loan belongs to {a.loan.branch.name}.</p>
          <ul className="flex flex-col rounded-xl border border-line" aria-label="Papers in the package">
            {papers.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 last:border-0">
                <span className="min-w-0 flex-1 text-[15px]">{d.label} <span className="tag">{d.originality === "ORIGINAL" ? "Original" : "Copy"}</span></span>
                {d.documentId && <span className="mono text-xs text-ink-2">{d.documentId}</span>}
              </li>
            ))}
          </ul>
          <ReceivePackageForm assignmentId={a.id} from={a.dpUser.name} papers={papers.length} />
          {inScope(user, a.loan.branchId) && <Link href={`/loans/${a.loan.pn}?tab=todo&work=${t.id}`} className="link text-sm">Open the loan file</Link>}
        </section>
      ) : (
        <Banner tone="ok">{t.status === "COMPLETED" ? "Received. The transaction is complete." : "This package is not waiting for you to receive it."}</Banner>
      )}
    </div>
  );
}
