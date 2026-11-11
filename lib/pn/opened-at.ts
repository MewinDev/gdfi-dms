import "server-only";
import { prisma } from "@/lib/db";
import { getPnFormat } from "./index";
import { parsePn } from "./format";

/**
 * Where a loan was OPENED (the branch code in its PN, a hint only) and where it is NOW (the loan's
 * branch, which always comes from the MyLoans branch field). Branch names only, no codes, on screen:
 * "Opened at Antipolo", or, when they differ, "Opened at Antipolo, now at Angono". A PN code that is
 * not a branch here yet still says its code. Null when the PN has no branch code.
 */
export interface OpenedAt { code: string; name: string | null; current: { name: string; code: string | null }; differs: boolean; text: string }

export async function openedAt(pn: string, current: { name: string; code: string | null }): Promise<OpenedAt | null> {
  const p = parsePn(pn, await getPnFormat());
  if (!p.ok || !p.parts) return null;
  const code = p.parts.branchCode;
  const b = current.code === code ? { name: current.name } : await prisma.branch.findUnique({ where: { code }, select: { name: true } });
  const at = b ? b.name : `branch code ${code} (not a branch here yet)`;
  const differs = current.code !== code;
  const now = current.name;
  return { code, name: b?.name ?? null, current, differs, text: differs ? `Opened at ${at}, now at ${now}` : `Opened at ${at}` };
}
