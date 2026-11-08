/**
 * Plain-language words for the Loan Associate screens (redesign word table, section 3).
 * Pure functions only, so they can be used by server and client components and unit tests.
 */
import { APP_TIMEZONE, businessDate, businessDaysBetween, fmtDate, noonOfBusinessDay, type TatBadge } from "@/lib/time";

export type Tone = "act" | "wait" | "ok" | "bad" | "mute" | "navy";

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export const STAGE_WORDS: Record<string, string> = {
  Opened: "Loan opened",
  "For checklist": "Check documents",
  "No DP assignment required": "Check documents",
  "Assigned to DP": "Waiting on processor",
  "In process": "Being processed",
  "Awaiting LA acceptance": "Check the returned package",
  "For Vault Transmittal": "Ready to send to vault",
  "In transit to Vault": "On its way to vault",
  "In Safekeeping": "Safe in vault",
  Closed: "Closed",
  Archived: "Archived",
  Disposed: "Disposed",
};

export function stageWords(stage: string): string {
  return STAGE_WORDS[stage] ?? stage;
}

/** Stages where the next step is the LA's. */
export const LA_STAGES = ["Opened", "For checklist", "No DP assignment required", "Awaiting LA acceptance", "For Vault Transmittal"];
/** Stages where someone else is working. */
export const WAITING_STAGES = ["Assigned to DP", "In process", "In transit to Vault"];

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

export interface DeadlineChip {
  text: string;
  tone: Tone;
  /** Higher = more urgent. */
  urgency: number;
}

export function deadlineChip(
  tat: { badge: TatBadge; deadline: string } | null | undefined,
  holidays: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): DeadlineChip | null {
  if (!tat) return null;
  const today = businessDate(now);
  if (tat.badge === "DUE_TODAY") return { text: "Due today", tone: "act", urgency: 2 };
  if (tat.badge === "OVERDUE") {
    const n = Math.max(1, businessDaysBetween(tat.deadline, today, holidays));
    return { text: `Late by ${n} day${n === 1 ? "" : "s"}`, tone: "bad", urgency: 3 };
  }
  const n = Math.max(1, businessDaysBetween(today, tat.deadline, holidays));
  return { text: `${n} day${n === 1 ? "" : "s"} left`, tone: "ok", urgency: 1 };
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export const TXN_WORDS: Record<string, string> = {
  NOTARY: "Notary",
  EDST: "EDST",
  PPSR: "Entry of PPSR",
  MORTGAGE: "Mortgage",
};

export function txnName(code: string, fallback?: string): string {
  return TXN_WORDS[code] ?? fallback ?? code;
}

export interface TxnLike {
  code: string;
  requiresDp: boolean;
  status: string;
  checkedCount: number;
  dpName?: string | null;
  receivingLaName?: string | null;
}

export function txnChip(t: TxnLike): { text: string; tone: Tone } {
  switch (t.status) {
    case "FOR_CHECKLIST":
      return t.checkedCount > 0 ? { text: "In progress", tone: "mute" } : { text: "Not started", tone: "mute" };
    case "READY":
      return { text: "Ready", tone: "act" };
    case "RETURNED":
      return { text: "Sent back", tone: "bad" };
    case "ASSIGNED":
      return { text: "Waiting", tone: "wait" };
    case "IN_PROCESS":
      return { text: "Being processed", tone: "wait" };
    case "FORWARDED":
      return { text: "Check package", tone: "act" };
    case "COMPLETED":
      return { text: "Done", tone: "ok" };
    default:
      return { text: "Cancelled", tone: "mute" };
  }
}

export function txnHint(t: TxnLike): string {
  if (!t.requiresDp) {
    if (t.status === "COMPLETED") return "Done. EDST reference recorded.";
    if (t.status === "READY") return "You do this one. Enter it and record the reference.";
    return "You do this one. No processor needed.";
  }
  switch (t.status) {
    case "FOR_CHECKLIST":
    case "READY":
      return "Send to a Document Processor";
    case "RETURNED":
      return "The processor sent it back. Fix it and send it again.";
    case "ASSIGNED":
      return `Waiting for ${t.dpName ?? "the processor"} to accept`;
    case "IN_PROCESS":
      return `${t.dpName ?? "The processor"} is working on it`;
    case "FORWARDED":
      return `Coming back to ${t.receivingLaName ?? "the branch"}. Check the package when it arrives.`;
    case "COMPLETED":
      return "Done";
    default:
      return "Cancelled";
  }
}

// ---------------------------------------------------------------------------
// The whole journey: 10 steps (the 10 phases of the Journey tab, in plain words)
// ---------------------------------------------------------------------------

/** The 10 steps of a loan's life, in the Journey tab's order. Labels are short so they never get cut. */
export const JOURNEY_STEPS = [
  { name: "Loan opened", who: "You" },
  { name: "Classified", who: "Automatic" },
  { name: "Check documents", who: "You" },
  { name: "Processing", who: "Processor" },
  { name: "Your acceptance", who: "You" },
  { name: "Vault", who: "Vault team" },
  { name: "DigiCur", who: "Digital Records" },
  { name: "Pull-out", who: "Vault team" },
  { name: "QA review", who: "QA team" },
  { name: "Closure", who: "Admin" },
] as const;
export const JOURNEY_STEP_COUNT = JOURNEY_STEPS.length;

/**
 * Current step (1-10) from the loan file's stage; 11 when every step is done (archived or disposed).
 * Steps 1 and 2 are done as soon as the loan file exists (opening runs the automatic classification).
 * Checking papers, labels and sending to a processor are all step 3, as in the Journey tab (phase 3).
 */
export function progressStep(stage: string): number {
  if (["Archived", "Disposed"].includes(stage)) return 11;
  if (stage === "Closed") return 10;
  if (stage === "In Safekeeping") return 7;
  if (["For Vault Transmittal", "In transit to Vault"].includes(stage)) return 6;
  if (stage === "Awaiting LA acceptance") return 5;
  if (["Assigned to DP", "In process"].includes(stage)) return 4;
  return 3;
}

export type StepState = "Done" | "Now" | "Later";
export const stepState = (n: number, current: number): StepState => (n < current ? "Done" : n === current ? "Now" : "Later");

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export function peso(n: number): string {
  return "₱" + n.toLocaleString("en-PH", { maximumFractionDigits: n % 1 === 0 ? 0 : 2 });
}

export function timeAgo(d: Date, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.round(h / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  // Older than a week: the PHT calendar day (never the server's or browser's own time zone).
  return fmtDate(d);
}

export function greeting(now: Date = new Date(), tz = APP_TIMEZONE): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/**
 * Rewords server messages for the LA screens (the server messages themselves are unchanged).
 */
export function plainMessage(text: string | undefined | null): string {
  if (!text) return "";
  return text
    .replace(/Beyond-TAT reason/g, "the reason why this is late")
    .replace(/past the Day 2 TAT/g, "past the Day 2 deadline")
    .replace(/Pasuyo: pick the secondary DP\./g, "Pick the second processor (Pasuyo).")
    .replace(/Pasuyo: the secondary DP must be a different person\./g, "The second processor (Pasuyo) must be a different person.")
    .replace(/Pasuyo: enter the reason\./g, "Tell us why a second processor (Pasuyo) is needed.")
    .replace(/Fund status Funded needs a released cash advance for this transaction\. Pick For funding or request one\./g,
      "\"Already funded\" needs money that Finance has released. Pick \"Yes, ask for money\" instead.")
    .replace(/Pick the fund status\./g, "Answer \"Does it need money?\".")
    .replace(/Legal Docs Completion exception/g, "request for the missing paper")
    .replace(/Legal Docs Completion/g, "Missing paper request")
    .replace(/exception/g, "problem")
    .replace(/see Exceptions/g, "see the problem on the To do tab")
    .replace(/Complete and save the (.+?) checklist before assigning\./g, "Tick all required papers for $1 first.")
    .replace(/Complete and save the (.+?) checklist first\./g, "Tick all required papers for $1 first.")
    .replace(/Checklist incomplete:/g, "Some papers are still missing:")
    .replace(/checklist/g, "list of papers")
    .replace(/is already assigned\./g, "has already been sent to a processor.")
    .replace(/Assigned to DP\. The DP has been notified in-app and by email\./g, "Sent. The processor has been told by notification and email.")
    .replace(/Pick an active DP of the selected DP branch\./g, "Pick a processor from that branch.")
    .replace(/Pick a DP branch\./g, "Pick the processor's branch.")
    .replace(/Mortgage: pick the LTO office\./g, "Pick the LTO office.");
}

// ---------------------------------------------------------------------------
// History sentences (audit rows in plain words)
// ---------------------------------------------------------------------------

export interface HistoryRow {
  actorLabel: string;
  action: string;
  mode: string;
  summary: string;
  after?: unknown;
  before?: unknown;
  details?: unknown;
}

const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function historySentence(r: HistoryRow): string {
  const a = obj(r.after);
  const who = r.actorLabel.replace(/ \(Simulated\)$/, "");
  switch (r.action) {
    case "loan_file_opened":
      return `${who} opened the loan file.`;
    case "classification_applied":
      return `The system marked this as a ${a.classification === "FINANCING" ? "Financing" : "Refinancing"} loan.`;
    case "financing_choices_recorded":
      return `${who} answered the two questions: ${a.financingType === "UNDERTAKING" ? "Undertaking" : "Non-Undertaking"}, OR/CR ${a.orcrStatus === "TRANSFERRED" ? "transferred" : "untransferred"}.`;
    case "mortgage_determined":
      return a.mortgageResult === "MORTGAGE"
        ? "The system checked the amount: a mortgage is needed."
        : a.mortgageResult === "NOT_MORTGAGE"
          ? "The system checked the amount: no mortgage needed."
          : "The system skipped the mortgage check because the OR/CR is untransferred.";
    case "transactions_generated": {
      const list = Array.isArray(a.transactions) ? (a.transactions as string[]).map((c) => txnName(c)).join(", ") : "";
      return `The system listed the work to do${list ? `: ${list}` : ""}.`;
    }
    case "checklist_saved": {
      const m = /Saved (.+?) checklist/.exec(r.summary);
      const name = m ? txnName(codeOf(m[1]), m[1]) : "the";
      return r.summary.includes(", complete") ? `${who} checked all the ${name} papers.` : `${who} updated the ${name} papers.`;
    }
    case "document_ids_generated": {
      const n = Array.isArray(a.documentIds) ? a.documentIds.length : 0;
      return `The system made ${n} new label${n === 1 ? "" : "s"}.`;
    }
    case "labels_printed": {
      const n = Array.isArray(a.documentIds) ? a.documentIds.length : 0;
      return `${who} printed ${n} label${n === 1 ? "" : "s"}.`;
    }
    case "edst_completed":
      return `${who} marked EDST done (reference ${String(a.edstReference ?? "")}).`;
    case "cash_advance_requested":
      return `${who} asked Finance for money: ${peso(Number(a.amount ?? 0))}.`;
    case "assigned_to_dp": {
      const m = /Assigned (.+?) to DP/.exec(r.summary);
      return `${who} sent the ${m?.[1] ?? "work"} to ${String(a.dp ?? "a processor")}.`;
    }
    case "dp_notified":
      return r.summary.replace(/^Notified (.+?) in-app and by email$/, "$1 was told by notification and email.");
    case "stage_changed":
      return `The loan moved to “${stageWords(String(a.stage ?? ""))}”.`;
    case "exception_raised":
      if (/^Missing paper asked for (.+?): (.+)$/.test(r.summary)) return r.summary.replace(/^Missing paper asked for (.+?): (.+)$/, `${who} asked for a missing paper for $1: $2.`);
      if (r.summary.startsWith("Raised Legal Docs Completion")) return `${who} asked for a missing paper.`;
      return `A problem was reported. ${r.summary}`;
    case "exception_resolved":
      if (/Missing paper closed|Legal Docs Completion resolved/.test(r.summary)) return "The missing paper was ticked, so the reminder closed.";
      return who === "System" ? "A problem was fixed automatically." : `${who} marked a problem as fixed.`;
    case "source_refreshed":
      return `${who} refreshed the details from MyLoans.`;
    case "source_refresh_failed":
      return "MyLoans could not be reached. The saved copy was shown.";
    case "automatic_result_overridden":
      return `A supervisor (${who}) changed the loan setup. Reason: ${String(obj(r.details).reason ?? "")}`;
    case "cash_advance_released":
      return "Finance released the money.";
    case "cash_advance_rejected":
      return "Finance said no to the money request.";
    case "cash_advance_liquidated":
      return "The processor showed the receipts for the money.";
    case "dp_assignment_accepted":
      return `${who} accepted the work and took the papers.`;
    case "dp_assignment_declined":
      return `${who} sent the work back.`;
    case "dp_processing_recorded":
      return `${who} finished the processing step.`;
    case "package_forwarded":
      return `${who} sent the package back to the branch.`;
    case "package_accepted":
      return `${who} checked the returned package: complete.`;
    case "package_incomplete":
      return `${who} checked the returned package: something is missing.`;
    case "transaction_completed":
      return "That part of the work is done.";
    case "transmittal_dispatched":
      return "The papers were sent to the vault.";
    case "vault_received":
      return "The vault received the papers.";
    case "vault_verified":
      return "The vault checked the papers.";
    case "vault_tagged":
      return "The papers were put in their places in the vault.";
    default:
      return `${who}: ${r.summary.replace(/^Simulated: /, "")}`;
  }
}

/**
 * Notification titles in plain sentences for the LA ("Updates").
 * The stored notification is unchanged; only how it reads on screen.
 */
export function plainUpdate(title: string, borrower?: string | null): string {
  const m = /^(PN-\d+): (.+)$/.exec(title);
  if (!m) return title;
  const who = borrower ? `${borrower}'s` : `${m[1]}`;
  const of = borrower ?? m[1];
  const rest = m[2];
  let r: RegExpExecArray | null;
  if (rest === "source data changed in MyLoans") return `MyLoans changed the details of ${who} loan. Please check it.`;
  if (rest === "automatic result overridden") return `A supervisor changed the setup of ${who} loan.`;
  if (rest === "package forwarded to you") return `The processor sent ${who} package back to you. Check it when it arrives.`;
  if (rest === "cash advance rejected") return `Finance said no to the money request for ${of}.`;
  if ((r = /^(.+) accepted$/.exec(rest))) return `The processor accepted the ${txnName(codeOf(r[1]), r[1])} for ${of}.`;
  if ((r = /^(.+) declined$/.exec(rest))) return `The processor sent back the ${txnName(codeOf(r[1]), r[1])} for ${of}.`;
  return `${of}: ${rest}.`;
}

function codeOf(name: string): string {
  return name === "For EDST" ? "EDST" : name === "For Entry PPSR" ? "PPSR" : name.toUpperCase();
}

/** "Nov 3, 2026" in the business time zone. Accepts a Date or YYYY-MM-DD. */
export function dayText(d: Date | string | null | undefined, opts: { year?: boolean } = { year: true }): string {
  if (!d) return "-";
  const date = typeof d === "string" ? (d.length === 10 ? noonOfBusinessDay(d) : new Date(d)) : d;
  return new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, month: "short", day: "numeric", ...(opts.year ? { year: "numeric" } : {}) }).format(date);
}

/** A processor assignment that is still the job: not declined, returned or pulled back. */
export const liveAssignment = (status: string) => !["DECLINED", "WITHDRAWN", "PULLED_BACK"].includes(status);
