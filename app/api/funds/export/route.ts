import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canFundsAny, typeWhere } from "@/lib/funds/access";
import { cashToSettleIds } from "@/lib/services/funds";
import { OPEN_ADVANCE } from "@/lib/funds/rules";
import { kindNames, lineKindText } from "@/lib/services/expense-kinds";
import { SOURCE_TEXT, OTHER, type AmountSource } from "@/lib/funds/kinds";
import { businessDate } from "@/lib/time";
import { fundsCsv, FUNDS_TAB_STATUS } from "@/lib/funds/export";

/**
 * CSV of the Finance funds lists (Funds page, Download CSV): the tab and the type filter (?ftype=CA)
 * the person picked, with a Type column. Only the types the person may see (See cash advances, See fund
 * transfers). Branch scope as on the page.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!canFundsAny(user, "view")) return NextResponse.json({ error: "You do not have permission to export funds." }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const tab = sp.get("tab") && sp.get("tab")! in FUNDS_TAB_STATUS ? sp.get("tab")! : "all";
  const types = await prisma.fundsType.findMany({ select: { code: true } });
  const ftype = types.find((t) => t.code === sp.get("ftype"))?.code;
  const rows = await prisma.cashAdvance.findMany({
    where: {
      ...(user.scopeBranchIds === null ? {} : { branchId: { in: user.scopeBranchIds } }),
      ...typeWhere(user),
      ...(ftype ? { fundsTypeCode: ftype } : {}),
      ...(tab === "all" ? {} : { status: { in: FUNDS_TAB_STATUS[tab] as never } }),
    },
    include: {
      requestedBy: { select: { id: true, name: true } }, branch: { select: { name: true, code: true, area: { select: { name: true } } } }, returns: true,
      lines: { include: { receipts: true, transaction: { include: { loan: { select: { pn: true } }, type: { select: { name: true } } } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  const names = await kindNames();
  const settle = await cashToSettleIds(rows.filter((a) => OPEN_ADVANCE.includes(a.status)).map((a) => ({ id: a.id, status: a.status, requestedById: a.requestedBy.id, lines: a.lines })));
  const csv = fundsCsv(rows.map((a) => ({
    number: a.number, typeCode: a.fundsTypeCode, typeName: a.fundsTypeName, status: a.status, processor: a.requestedBy.name, branch: a.branch.name, branchCode: a.branch.code ?? "", area: a.branch.area?.name ?? "",
    requestedCents: a.requestedCents, approvedCents: a.approvedCents, releasedCents: a.releasedCents,
    receiptCents: a.lines.flatMap((l) => l.receipts).reduce((s, r) => s + r.cents, 0), returnedCents: a.returns.reduce((s, r) => s + r.cents, 0),
    releasedOn: a.releasedAt ? businessDate(a.releasedAt) : "", releaseRef: a.releaseRef, transferDate: a.transferDate,
    accountProvider: a.accountProvider, accountName: a.accountName, accountLast4: a.accountLast4,
    liquidateBy: a.liquidationDueAt ? businessDate(a.liquidationDueAt) : "", cashToSettle: settle.has(a.id),
    lines: a.lines.map((l) => `${lineKindText(names, l)}${l.transaction ? ` ${l.transaction.loan.pn} ${l.transaction.type.name}` : ""}`).join("; "),
    otherDescriptions: a.lines.filter((l) => l.kind === OTHER).map((l) => l.otherDescription || "(not described)").join("; "),
    presetAmounts: a.lines.map((l) => (l.presetCents === null ? "" : (l.presetCents / 100).toFixed(2))).join("; ").replace(/^(; )+$/, ""),
    locked: a.lines.map((l) => (l.locked ? "Yes" : "No")).join("; "),
    amountSources: a.lines.map((l) => SOURCE_TEXT[l.amountSource as AmountSource] ?? l.amountSource).join("; "),
  })));
  await prisma.auditLog.create({ data: { actorId: user.id, actorLabel: user.name, mode: "MANUAL", action: "funds_exported", entityType: "Report", summary: `Exported funds (${tab}${ftype ? `, type ${ftype}` : ""}): ${rows.length} row(s)`, details: { tab, ftype: ftype ?? null } } });
  return new NextResponse("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="gdfi-dms-funds-${ftype ? `${ftype.toLowerCase()}-` : ""}${businessDate(new Date())}.csv"`, "Cache-Control": "no-store" },
  });
}
