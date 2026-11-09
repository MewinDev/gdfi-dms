import { prisma, type Tx } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { DEFAULT_PN_FORMAT, parsePn, type PnFormat, type PnParse } from "./format";

export * from "./format";

/** The PN format from Settings (System, PN format), with the defaults for anything missing. */
export async function getPnFormat(db: Tx | typeof prisma = prisma): Promise<PnFormat> {
  return { ...DEFAULT_PN_FORMAT, ...(await getSetting("pn.format", db)) };
}

/** parsePn with the format from Settings. */
export async function checkPn(input: string, now: Date = new Date()): Promise<PnParse> {
  return parsePn(input, await getPnFormat(), now);
}
