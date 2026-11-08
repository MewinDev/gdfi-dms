import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { can, inScope, requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PrintLabelsButton } from "@/components/loan/print-labels-button";

export const metadata: Metadata = { title: "Print labels" };

export default async function LabelsPage({ params, searchParams }: { params: Promise<{ pn: string }>; searchParams: Promise<{ ids?: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.LOANS_VIEW);
  const { pn } = await params;
  const loan = await prisma.loan.findUnique({ where: { pn: decodeURIComponent(pn).toUpperCase() }, include: { branch: true } });
  if (!loan || !inScope(user, loan.branchId)) notFound();
  const ids = ((await searchParams).ids ?? "").split(",").filter(Boolean);
  const docs = await prisma.documentItem.findMany({
    where: { loanId: loan.id, documentId: { not: null }, ...(ids.length ? { id: { in: ids } } : {}) },
    orderBy: { documentId: "asc" },
  });
  const labels = await Promise.all(
    docs.map(async (d) => ({ ...d, svg: await QRCode.toString(d.documentId!, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) })),
  );

  return (
    <div className="w-full space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-title">Labels for {loan.borrowerName}</h1>
          <p className="muted">{loan.pn} · {labels.length} label{labels.length === 1 ? "" : "s"}. Print them, then stick each label on its paper.</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/loans/${loan.pn}?tab=documents`} className="btn-ghost">Back to documents</Link>
          {labels.length > 0 && <PrintLabelsButton ids={labels.map((l) => l.id)} canMark={can(user, PERMISSIONS.LABELS_PRINT)} />}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 print:grid-cols-2">
        {labels.map((l) => (
          <div key={l.id} className="flex break-inside-avoid items-center gap-3 rounded-lg border border-ink p-3">
            <div className="h-24 w-24 shrink-0" aria-label={`QR code for ${l.documentId}`} role="img" dangerouslySetInnerHTML={{ __html: l.svg }} />
            <div className="min-w-0 text-xs">
              <p className="mono text-sm font-bold">{l.documentId}</p>
              <p className="font-semibold">{l.label}</p>
              <p>{l.originality === "ORIGINAL" ? "Original" : "Copy"} · {loan.borrowerName}</p>
              <p>{loan.branch.name} · GDFI DMS</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
