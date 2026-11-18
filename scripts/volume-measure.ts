/**
 * Times the main screens' server work on gdfi_dms_volume_test (scripts/volume.ts; D-055): the median of 3 runs, in ms,
 * after one warm-up, for an LA (two branches), an LA Supervisor/Head and Admin (all branches). The target is ~2 s.
 */
import { prisma } from "@/lib/db";
import { CURRENT_USER_INCLUDE, toCurrentUser } from "@/lib/auth/build-user";
import { listLoans } from "@/lib/services/queries";
import { myItems, poolItems } from "@/lib/services/work-items";
import { openItemsFor, openItemCounts, pendingOpenItemCount } from "@/lib/services/open-items";
import { tatReport } from "@/lib/services/tat-report";
import { fileLogPage } from "@/lib/services/file-access-log";
import { searchSaved } from "@/lib/services/find-local";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function time(f: () => Promise<unknown>): Promise<number> {
  await f(); // warm-up
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) { const t = performance.now(); await f(); runs.push(performance.now() - t); }
  return Math.round(median(runs));
}

(async () => {
  const db = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  if (db !== "gdfi_dms_volume_test") throw new Error(`Refused: this measures gdfi_dms_volume_test only, not ${db}.`);
  const as = async (email: string) => toCurrentUser(await prisma.user.findUniqueOrThrow({ where: { email }, include: CURRENT_USER_INCLUDE }));
  const people = { "LA (2 branches)": await as("test.la@gdfi.ph"), "LA Supervisor/Head": await as("test.lahead@gdfi.ph"), "Admin (all branches)": await as("test.admin@gdfi.ph") };
  const screens: [string, (u: Awaited<ReturnType<typeof as>>) => Promise<unknown>][] = [
    ["Inbox (my items)", (u) => myItems(u)],
    ["Branch pool", (u) => poolItems(u)],
    ["Open Items (Mine)", (u) => openItemsFor(u, "mine")],
    ["Open Items menu count + Home", async (u) => { await pendingOpenItemCount(u); await openItemCounts(u); }],
    ["Loans list (All)", (u) => listLoans(u, { tab: "all" })],
    ["TAT report", (u) => tatReport(u, {})],
    ["File access log (page 1)", (u) => fileLogPage(u, {}, 1)],
    ["Find loan (type 'GD9500')", (u) => searchSaved(u, "GD9500", 8)],
  ];
  const counts = { loans: await prisma.loan.count(), workItems: await prisma.workItem.count(), openItems: await prisma.openItem.count(), fileLog: await prisma.fileAccessLog.count() };
  console.log(`Data: ${counts.loans} loans, ${counts.workItems} work items, ${counts.openItems} Open Items, ${counts.fileLog} file log rows.`);
  console.log(["Screen".padEnd(32), ...Object.keys(people).map((k) => k.padStart(22))].join(""));
  for (const [name, f] of screens) {
    const cells: string[] = [];
    for (const u of Object.values(people)) {
      try { const ms = await time(() => f(u)); cells.push(`${ms} ms${ms > 2000 ? " (slow)" : ""}`.padStart(22)); }
      catch (e) { cells.push(`n/a: ${(e instanceof Error ? e.message : String(e)).slice(0, 14)}`.padStart(22)); }
    }
    console.log([name.padEnd(32), ...cells].join(""));
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; await prisma.$disconnect(); });
