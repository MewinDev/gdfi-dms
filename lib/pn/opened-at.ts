import "server-only";
import { prisma } from "@/lib/db";
import { getPnFormat } from "./index";
import { parsePn } from "./format";

/**
 * Where a loan was OPENED (the branch code in its PN, a hint only) and where it is NOW (the loan's
 * branch, which always comes from the MyLoans branch field). "Opened at Antipolo (101)", or, when they
 * differ, "Opened at Antipolo (101), now at Angono (165)". Null when the PN has no branch code.
 */
export interface OpenedAt { code: string; name: string | null; current: { name: string; code: string | null }; differs: boolean; text: string }

export async function openedAt(pn: string, current: { name: string; code: string | null }): Promise<OpenedAt | null> {
  const p = parsePn(pn, await getPnFormat());
  if (!p.ok || !p.parts) return null;
  const code = p.parts.branchCode;
  const b = current.code === code ? { name: current.name } : await prisma.branch.findUnique({ where: { code }, select: { name: true } });
  const at = b ? `${b.name} (${code})` : `branch code ${code} (not a branch here yet)`;
  const differs = current.code !== code;
  const now = `${current.name}${current.code ? ` (${current.code})` : ""}`;
  return { code, name: b?.name ?? null, current, differs, text: differs ? `Opened at ${at}, now at ${now}` : `Opened at ${at}` };
}
