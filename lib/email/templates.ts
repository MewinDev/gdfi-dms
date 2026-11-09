/**
 * Email events, their default messages and the branded layout. Pure: used on the server to build
 * each email and in the browser for the live preview in Settings. No secrets here.
 */

export const EMAIL_EVENTS = {
  job_sent: {
    label: "Job sent to a processor", to: "The processor (and the second processor, Pasuyo)", urgent: true,
    subject: "{pn}: {transaction} sent to you",
    body: "{who} sent you {transaction} for {pn} on {when}.\nPlease accept or decline it today.\n{reason}",
  },
  job_changed: {
    label: "Job changed, reassigned or pulled back before accept", to: "The old and the new processor", urgent: false,
    subject: "{pn}: {transaction} changed",
    body: "{who} changed {transaction} for {pn} on {when}.\n{reason}",
  },
  job_accepted: {
    label: "Job accepted", to: "The Loan Associate who sent it", urgent: false,
    subject: "{pn}: {transaction} accepted",
    body: "{who} accepted {transaction} for {pn} on {when}.",
  },
  job_declined: {
    label: "Job declined", to: "The Loan Associate who sent it", urgent: true,
    subject: "{pn}: {transaction} declined",
    body: "{who} declined {transaction} for {pn} on {when}.\nReason: {reason}\nCorrect it and send it again.",
  },
  returned_to_la: {
    label: "Returned to the LA: papers needed", to: "The branch Loan Associates", urgent: true,
    subject: "{pn}: {transaction} returned, papers needed",
    body: "{who} returned {transaction} for {pn} on {when}.\nPapers needed: {reason}\nThe turnaround time keeps counting.",
  },
  job_resent: {
    label: "Re-sent after a return", to: "The processor", urgent: true,
    subject: "{pn}: {transaction} sent to you again",
    body: "{who} sent {transaction} for {pn} again on {when}, after it was returned.\nPlease accept or decline it today.\n{reason}",
  },
  hold_changed: {
    label: "Put on hold or resumed", to: "The branch Loan Associates", urgent: false,
    subject: "{pn}: {transaction} {status}",
    body: "{transaction} for {pn} was {status} on {when}.\n{reason}",
  },
  problem_changed: {
    label: "Problem raised or resolved", to: "The branch Loan Associates and the processor involved", urgent: true,
    subject: "{pn}: problem {status} on {transaction}",
    body: "A problem was {status} on {transaction} for {pn} on {when}.\n{reason}\nThe turnaround time keeps counting.",
  },
  missing_paper: {
    label: "Missing paper requested", to: "The other party (the processor or the supervisors)", urgent: false,
    subject: "{pn}: missing paper for {transaction}",
    body: "{who} asked for a missing paper for {transaction} on {pn} on {when}.\n{reason}",
  },
  pasuyo_passed: {
    label: "Passed to another processor (Pasuyo)", to: "The second processor and the branch Loan Associates", urgent: false,
    subject: "{pn}: {transaction} passed to another processor",
    body: "{who} passed {transaction} for {pn} to another processor on {when}.\n{reason}",
  },
  advance_requested: {
    label: "Cash advance or fund transfer waiting for approval", to: "Approvers for the amount (approval bands)", urgent: true,
    subject: "{number}: {kind} to approve",
    body: "{who} asked for a {kind} of {amount} on {when}.\n{reason}\nPlease approve or deny it.",
  },
  advance_decided: {
    label: "Cash advance or fund transfer approved or denied", to: "The processor, and Finance when it needs release", urgent: false,
    subject: "{number}: {kind} {status}",
    body: "{number} ({kind}) was {status} by {who} on {when}.\n{reason}",
  },
  advance_released: {
    label: "Cash advance released or fund transfer sent", to: "The processor", urgent: true,
    subject: "{number}: {kind} {status}",
    body: "{kind}: {amount} was {status} on {when}.\nLiquidate with receipts or return the cash.",
  },
  cash_returned: {
    label: "Cash returned or liquidation submitted", to: "Finance", urgent: false,
    subject: "{number}: {status}",
    body: "{who}: {status} on {when}.\n{reason}",
  },
  liquidation_due: {
    label: "Liquidation due soon or overdue (reminder)", to: "The processor and Finance", urgent: false,
    subject: "{number}: liquidation {status}",
    body: "{number}: liquidation is {status}.\n{reason}",
  },
  approval_waiting: {
    label: "Approval waiting more than a business day (reminder)", to: "Approvers for the amount (approval bands)", urgent: true,
    subject: "{number}: still waiting for approval",
    body: "{number} from {who} has waited more than a business day.\nPlease approve or deny it.",
  },
  package_moved: {
    label: "Papers forwarded to an LA, and received", to: "The receiving Loan Associate, and the processor who sent them", urgent: false,
    subject: "{pn}: {transaction} papers {status}",
    body: "{who}: the {transaction} papers for {pn} were {status} on {when}.\n{reason}",
  },
  source_changed: {
    label: "MyLoans changed a loan (Admin reviews)", to: "Admin, the branch Loan Associates and the processors on it", urgent: false,
    subject: "{pn}: MyLoans changed this loan",
    body: "{reason}\nAdmin is reviewing it. Until then the work it reaches waits.\nWhen: {when}.",
  },
  lto_advisory: {
    label: "LTO advisory filed or resolved", to: "The Operations Monitors", urgent: true,
    subject: "LTO advisory {status}: {office}",
    body: "{office}: {kind}, {status} by {who} on {when}.\n{reason}",
  },
  tat_digest: {
    label: "Overdue work (daily digest)", to: "Branch Loan Associates and Admin", urgent: false,
    subject: "Overdue work today: {count}",
    body: "{count} transaction(s) are past their turnaround time today ({when}).\n{reason}",
  },
} as const;

export type EmailEventKey = keyof typeof EMAIL_EVENTS;

/** Values used when a sender gives none: the funds emails read right for older callers too. */
export const EVENT_DEFAULT_VARS: Partial<Record<EmailEventKey, Partial<Record<string, string>>>> = {
  advance_released: { status: "released", kind: "Cash advance" },
  advance_requested: { kind: "Cash advance" },
  advance_decided: { kind: "Cash advance" },
};
export const EMAIL_EVENT_KEYS = Object.keys(EMAIL_EVENTS) as EmailEventKey[];
export const isEmailEvent = (k: string): k is EmailEventKey => k in EMAIL_EVENTS;

/** Placeholders a message may use, with what each one becomes. */
export const PLACEHOLDERS = {
  pn: "The PN, for example PN-0001003",
  transaction: "The transaction, for example Notary",
  who: "Who did it",
  when: "When, in Philippine time",
  reason: "The reason or note (one line)",
  status: "What happened, for example put on hold",
  amount: "The amount, or \"an amount\" for people who may not see amounts",
  number: "The cash advance number, for example CA-2026-0001",
  kind: "The funds type, for example Cash advance or Fund transfer",
  count: "How many",
  recipient: "The person's name",
  office: "The LTO office, for example LTO Quezon City District Office",
} as const;
export type Placeholder = keyof typeof PLACEHOLDERS;
export type EmailVars = Partial<Record<Placeholder, string>>;

/** Placeholders in a text that are not in the list (for Save). */
export function unknownPlaceholders(text: string): string[] {
  const found = [...text.matchAll(/\{([^{}\s]*)\}/g)].map((m) => m[1]);
  return [...new Set(found.filter((p) => !(p in PLACEHOLDERS)))];
}

/** Fills the placeholders; empty ones become "". Lines left empty are dropped. */
export function fill(template: string, vars: EmailVars): string {
  return template.replace(/\{([a-z]+)\}/g, (m, k: string) => (k in PLACEHOLDERS ? (vars[k as Placeholder] ?? "").trim() : m));
}
export function fillLines(template: string, vars: EmailVars): string[] {
  return fill(template, vars).split("\n").map((l) => l.trim()).filter((l) => l && !/^(Reason|Papers needed):\s*$/.test(l));
}

/** Sample values for the preview in Settings. */
export const SAMPLE_VARS: EmailVars = {
  pn: "PN-0001003", transaction: "Notary", who: "Ana Reyes (LA)", when: "Nov 7, 2026, 2:15 PM PHT", reason: "Reason: The ID copy is in the brown envelope.",
  status: "put on hold", amount: "₱1,500.00", number: "CA-2026-0001", kind: "Cash advance", count: "3", recipient: "Joy Navarro", office: "LTO Quezon City District Office",
};

export const EMAIL_FOOTER = "You get this because of your role in GDFI DMS. This is an automatic message from a mailbox nobody reads.";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The branded email: navy header with a gold line, one headline, a few lines, one gold button.
 * Tables and inline styles so it reads well in Outlook and on phones. No images.
 */
export function renderEmail(m: { headline: string; lines: string[]; link: string | null; note?: string | null }): { html: string; text: string } {
  const lines = m.lines.map((l) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.5;color:#1f2937">${esc(l)}</p>`).join("");
  const note = m.note ? `<p style="margin:0 0 14px;padding:8px 12px;border-radius:8px;background:#fff7e6;color:#7a4b00;font-size:13px">${esc(m.note)}</p>` : "";
  const button = m.link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 6px"><tr><td style="border-radius:10px;background:#f5a623"><a href="${esc(m.link)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:#0c2340;text-decoration:none;border-radius:10px">Open in GDFI DMS</a></td></tr></table>`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.headline)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f8;font-family:Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f8;padding:16px 8px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0c2340;padding:16px 22px;color:#ffffff;font-size:17px;font-weight:700">GDFI DMS<div style="font-size:12px;font-weight:400;color:#cbd5e1">Loan documents</div></td></tr>
<tr><td style="height:4px;background:#f5a623;line-height:4px;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:22px">
${note}<h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#0c2340">${esc(m.headline)}</h1>
${lines}${button}
</td></tr>
<tr><td style="padding:14px 22px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280">${esc(EMAIL_FOOTER)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [m.note ?? "", m.headline, "", ...m.lines, "", m.link ? `Open in GDFI DMS: ${m.link}` : "", "", EMAIL_FOOTER].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n").trim();
  return { html, text };
}
