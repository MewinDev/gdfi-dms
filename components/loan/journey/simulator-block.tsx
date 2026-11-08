import Link from "next/link";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { advancesOf, type LoanDetail } from "@/lib/services/queries";
import { getSetting } from "@/lib/settings";
import { SimulatorPanel, type SimButton } from "@/components/loan/forms";
import { liveAssignment } from "@/lib/ui/plain";
import { isTestMode } from "@/lib/test-mode";
import { appEnv, isProduction } from "@/lib/env";
import { myLoansMode } from "@/lib/myloans";
import { SimulateSourceChange } from "@/components/loan/source-review";

/** Admin test simulator on the Journey tab (test mode switch on). Every event it makes is labelled Simulated. */
export async function SimulatorBlock({ loan, user }: { loan: LoanDetail; user: CurrentUser }) {
  // Only in test mode, never on staging or production (the server refuses too: assertSimulatorAllowed).
  if (isProduction() || appEnv() === "staging" || !isTestMode() || !can(user, PERMISSIONS.SIMULATOR_USE)) return null;
  const on = await getSetting("simulator.enabled");
  if (!on) {
    return <p className="card p-3 text-xs text-ink-2">The test simulator is off. Turn it on in <Link href="/admin/settings?open=system" className="underline">Settings</Link>.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <SimulatorPanel loanId={loan.id} groups={simGroups(loan)} />
      {isTestMode() && myLoansMode() === "mock" && <SimulateSourceChange loanId={loan.id} />}
    </div>
  );
}

function simGroups(loan: LoanDetail): { title: string; buttons: SimButton[] }[] {
  const groups: { title: string; buttons: SimButton[] }[] = [];
  const ca: SimButton[] = [];
  for (const c of advancesOf(loan)) {
    if (c.status === "REQUESTED" || c.status === "APPROVED") ca.push({ action: "CA_RELEASE", targetId: c.id, label: `Finance approves and releases ${c.number}` });
    if (c.status === "REQUESTED") ca.push({ action: "CA_REJECT", targetId: c.id, label: `Finance denies ${c.number}` });
    if (["RELEASED", "FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED"].includes(c.status)) ca.push({ action: "CA_LIQUIDATE", targetId: c.id, label: `DP liquidates ${c.number} with receipts` });
    if (c.status === "LIQUIDATED") ca.push({ action: "CA_CLOSE", targetId: c.id, label: `Finance closes ${c.number}` });
  }
  for (const t of loan.transactions) {
    const a = t.dpAssignments.find((x) => x.status === "ACCEPTED");
    const open = t.advanceLines.some((l) => !l.denied && !["DENIED", "CANCELLED"].includes(l.advance.status));
    if (a && t.status === "IN_PROCESS" && t.fundsNeeded === "YES" && !open) ca.push({ action: "FUNDS_REQUEST", targetId: a.id, label: `DP requests funds for ${t.type.name}` });
  }
  if (ca.length) groups.push({ title: "Cash advance (3.4, 3.5, 4.5)", buttons: ca });
  for (const t of loan.transactions) {
    const a = t.dpAssignments.find((x) => liveAssignment(x.status));
    if (!a) continue;
    const b: SimButton[] = [];
    if (t.status === "ASSIGNED" && a.status === "PENDING_ACCEPTANCE") b.push({ action: "DP_ACCEPT", targetId: a.id, label: "DP accepts" }, { action: "DP_DECLINE", targetId: a.id, label: "DP declines" });
    if (t.status === "IN_PROCESS" && !a.processing) b.push({ action: "DP_PROCESS", targetId: a.id, label: t.type.code === "NOTARY" ? "Record notary details" : t.type.code === "PPSR" ? "Record PPSR registration" : "LTO drop and pickup" });
    if (t.status === "IN_PROCESS" && a.processing) b.push({ action: "DP_FORWARD", targetId: a.id, label: "Forward to branch LA" });
    if (t.status === "FORWARDED") b.push({ action: "LA_ACCEPT_COMPLETE", targetId: a.id, label: "Receiving LA: Complete" }, { action: "LA_ACCEPT_INCOMPLETE", targetId: a.id, label: "Receiving LA: Incomplete" });
    if (b.length) groups.push({ title: `${t.type.name} (Phases 4-5)`, buttons: b });
  }
  if (loan.stage === "For Vault Transmittal") groups.push({ title: "Transmittal (6.1)", buttons: [{ action: "TRANSMIT", label: "Dispatch transmittal to Vault" }] });
  if (loan.stage === "In transit to Vault") groups.push({ title: "Vault (6.2-6.4)", buttons: [{ action: "VAULT_RECEIVE", label: "Vault receives, verifies, tags" }] });
  return groups;
}


