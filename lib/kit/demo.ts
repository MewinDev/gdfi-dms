import { prisma } from "@/lib/db";
import { CURRENT_USER_INCLUDE, toCurrentUser } from "@/lib/auth/build-user";
import { addWorkingDays, daysFor } from "@/lib/calendar/core";
import { loadCalendar } from "@/lib/calendar/load";
import { businessDate } from "@/lib/time";
import { openLoanFile } from "@/lib/services/loan-file";
import { raiseHold } from "@/lib/services/holds";
import { receiveReleasedLoan } from "@/lib/services/work-items";
import { CLEAN_ACCOUNTS, CLEAN_POOL } from "./clean";

/**
 * npm run kit:demo (D-048): a few AGED inbox items on top of the clean kit, so the demo shows every colour
 * (docs/DEMO_SCRIPT.md). Everything is made through the app's own code, then moved back in time:
 *   - LA Angono's items: one overdue (red), one due today (amber), one on a pausing hold (Paused);
 *   - the Angono LA pool: two released loans not yet in the DMS, waiting 1 working day (amber) and 3 (red).
 * The walkthrough's own PNs (GD1652026903019 and GD1652026903012) are left untouched. Safe to run once per reset.
 */
export const DEMO_PNS = { red: "GD1652026903013", amber: "GD1652026903016", paused: "GD1652026903017", poolAmber: "GD1652026903014", poolRed: "GD1652026903015" } as const;

const at9 = (ymd: string) => new Date(`${ymd}T09:00:00+08:00`);

export async function seedDemoItems(log: (line: string) => void = console.log): Promise<void> {
  const email = CLEAN_ACCOUNTS.find((a) => a.key === "laAngono")!.email;
  const la = toCurrentUser(await prisma.user.findUniqueOrThrow({ where: { email }, include: CURRENT_USER_INCLUDE }));
  const angono = await prisma.branch.findUniqueOrThrow({ where: { code: "165" } });
  if (await prisma.loan.count({ where: { pn: { in: [DEMO_PNS.red, DEMO_PNS.amber, DEMO_PNS.paused] } } })) {
    log("The demo items are already there (reset the kit first to make them again). Nothing changed.");
    return;
  }
  const days = daysFor(await loadCalendar(), angono.id);
  const today = businessDate(new Date());
  const back = (n: number) => addWorkingDays(today, -n, days);
  const open = async (pn: string) => {
    await openLoanFile(la, { pn });
    return prisma.workItem.findFirstOrThrow({ where: { kind: "TRANSACTION", pn, state: "HELD" }, orderBy: { arrivedAt: "asc" } });
  };

  // Overdue (red): opened 4 working days ago with a 1-day target, so due 3 working days ago.
  const red = await open(DEMO_PNS.red);
  await prisma.workItem.update({ where: { id: red.id }, data: { arrivedAt: at9(back(4)), acceptedAt: at9(back(4)), dueDate: back(3), overallDueDate: back(3) } });
  // Due today (amber).
  const amber = await open(DEMO_PNS.amber);
  await prisma.workItem.update({ where: { id: amber.id }, data: { arrivedAt: at9(back(1)), acceptedAt: at9(back(1)), dueDate: today, overallDueDate: today } });
  // Paused: on hold for the client's papers (that reason pauses the TAT).
  const paused = await open(DEMO_PNS.paused);
  const reason = await prisma.holdReason.findFirstOrThrow({ where: { code: "CLIENT-PAPERS" } });
  await raiseHold(la, { transactionId: paused.subjectId, reasonId: reason.id, note: "Demo: waiting for the borrower's OR/CR copy" });

  // The branch pool: released loans not yet opened (the feed's hook, piece 10b), waiting 1 and 3 working days.
  const borrower = (pn: string) => CLEAN_POOL.find((x) => x.pn === pn)?.borrower ?? "Sample borrower";
  for (const [pn, waited] of [[DEMO_PNS.poolAmber, 1], [DEMO_PNS.poolRed, 3]] as const) {
    const it = await prisma.$transaction((tx) => receiveReleasedLoan(tx, { pn, branchId: angono.id, borrowerName: borrower(pn) }));
    await prisma.workItem.update({ where: { id: it.id }, data: { arrivedAt: at9(back(waited)) } });
  }
  log(`Demo items for LA Angono: ${DEMO_PNS.red} overdue (red), ${DEMO_PNS.amber} due today (amber), ${DEMO_PNS.paused} on hold (Paused). Angono LA pool: ${DEMO_PNS.poolAmber} waiting 1 working day (amber), ${DEMO_PNS.poolRed} waiting 3 (red).`);
}
