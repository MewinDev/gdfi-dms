import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CLOCK_NOTE, NO_DETAILS, TO_CONTINUE, agoText, durationText, firstLine, holdRemarksSchema, holdRowLine, holdSummaryText,
  NO_OWNER, financeLockedMessage, journeyHoldResumed, journeyHoldStarted, journeyHoldTransferred, lockedMessage, needsResumeBy, mayAddDetails, mayResumeHold, onlyHolderMessage, REMARKS_HELP, REMARKS_MAX, REMARKS_MIN,
  remarksCounter, remarksSchema, resumeRemarksSchema,
} from "./holds";

// The summary's buttons call server actions; the render test only needs a stub for each exported action.
async function stubActions(file: string) {
  const { readFileSync } = await import("node:fs");
  const names = [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
  return Object.fromEntries(names.map((n) => [n, async () => null]));
}
vi.mock("@/app/actions/jobs", () => stubActions("app/actions/jobs.ts"));
vi.mock("@/app/actions/loan", () => stubActions("app/actions/loan.ts"));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));

const raisedAt = new Date("2026-11-07T06:32:51Z"); // Nov 7, 2026, 2:32 PM PHT
const now = new Date("2026-11-08T06:40:00Z");

describe("Hold summary: the reason category and the remarks, everywhere", () => {
  it("title, remarks as typed, who and when (PHT) and how long ago, and how to continue", () => {
    const t = holdSummaryText({ reason: "Other", note: "No Available DP", raisedBy: "Test Loan Associate", raisedAt }, now);
    expect(t.title).toBe("On hold: Other");
    expect(t.remarks).toBe("No Available DP");
    expect(t.byLine).toBe("Put on hold by Test Loan Associate · Nov 7, 2026, 2:32 PM PHT · 1 day ago");
    expect(t.toContinue).toBe(TO_CONTINUE);
    expect(TO_CONTINUE).toBe("To continue: press Resume and write what changed");
  });

  it("keeps the remarks in full (several lines too)", () => {
    const note = "Borrower is abroad until Friday.\nWill send the signed page by courier.";
    expect(holdSummaryText({ reason: "Waiting on borrower", note, raisedBy: "Ana", raisedAt }, now).remarks).toBe(note);
    expect(firstLine(note)).toBe("Borrower is abroad until Friday.");
  });

  it("an older hold without remarks says so (and the Open items card says the same)", () => {
    expect(holdSummaryText({ reason: "Other", note: "", raisedBy: "Ana", raisedAt }, now).remarks).toBeNull();
    expect(holdSummaryText({ reason: "Other", note: "   ", raisedBy: "Ana", raisedAt }, now).remarks).toBeNull();
    expect(firstLine("")).toBe(NO_DETAILS);
    expect(NO_DETAILS).toBe("No details were written.");
  });

  it("Resume and Add details: only the hold owner (Admin and supervisors included: they transfer, never resume)", () => {
    const h = { note: "", ownerId: "u-la", resumedAt: null };
    expect(mayResumeHold(h, { id: "u-la" })).toBe(true);
    expect(mayResumeHold(h, { id: "u-admin" })).toBe(false);
    expect(mayResumeHold({ ...h, ownerId: null }, { id: "u-la" })).toBe(false);
    // After a transfer the new owner resumes; the old holder no longer can.
    expect(mayResumeHold({ ...h, ownerId: "u-la2" }, { id: "u-la" })).toBe(false);
    expect(mayResumeHold({ ...h, ownerId: "u-la2" }, { id: "u-la2" })).toBe(true);
    expect(mayAddDetails(h, { id: "u-la" })).toBe(true);
    expect(mayAddDetails(h, { id: "u-admin" })).toBe(false);
    expect(mayAddDetails({ ...h, note: "Has remarks" }, { id: "u-la" })).toBe(false);
    expect(mayAddDetails({ ...h, resumedAt: now }, { id: "u-la" })).toBe(false);
    expect(onlyHolderMessage("Test Loan Associate")).toBe("Only Test Loan Associate can resume this.");
  });

  it("the lock message names the holder, when (PHT) and who can resume", () => {
    expect(lockedMessage("Test Loan Associate", raisedAt)).toBe("Locked: on hold by Test Loan Associate since Nov 7, 2026, 2:32 PM PHT. Only Test Loan Associate can resume.");
    expect(lockedMessage("Test Loan Associate", raisedAt, "Second LA")).toBe("Locked: on hold by Test Loan Associate since Nov 7, 2026, 2:32 PM PHT. Only Second LA can resume.");
    expect(lockedMessage("Test Loan Associate", raisedAt, null)).toBe(`Locked: on hold by Test Loan Associate since Nov 7, 2026, 2:32 PM PHT. ${NO_OWNER}`);
    expect(financeLockedMessage("Test Loan Associate", raisedAt)).toBe("Locked: on hold by Test Loan Associate since Nov 7, 2026, 2:32 PM PHT.");
  });

  it("transfer wording: who must resume it, and the Journey line", () => {
    expect(needsResumeBy("Ana Cruz")).toBe("Needs to be resumed by Ana Cruz. Ask your supervisor if Ana Cruz is away.");
    expect(needsResumeBy(null)).toBe("Nobody can resume it until a supervisor or Admin transfers the hold. Ask your supervisor.");
    expect(journeyHoldTransferred({ fromLabel: "Ana Cruz", toLabel: "Ben Reyes", byLabel: "Test Finance", note: "Ana is on leave", at: now }))
      .toBe("Hold transferred from Ana Cruz to Ben Reyes by Test Finance · Ana is on leave · Nov 8, 2026, 2:40 PM PHT");
  });

  it("days and hours: ago, duration and the row line", () => {
    expect(agoText(new Date(now.getTime() - 30_000), now)).toBe("just now");
    expect(agoText(new Date(now.getTime() - 3 * 3_600_000), now)).toBe("3 hours ago");
    expect(durationText(26 * 3_600_000)).toBe("1 day");
    expect(durationText(5 * 60_000)).toBe("5 minutes");
    expect(holdRowLine("Other", 1)).toBe("On hold: Other · 1 day");
    expect(holdRowLine("Waiting on borrower", 3)).toBe("On hold: Waiting on borrower · 3 days");
  });
});

describe("Remark limits: 5 to 500 characters, trimmed, one constant for every box", () => {
  it.each([["Put on hold", holdRemarksSchema], ["Resume", resumeRemarksSchema], ["Add details, Decline, Return to LA", remarksSchema]] as const)("%s", (_name, schema) => {
    expect(schema.safeParse("").success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(false);
    expect(schema.safeParse("  abcd  ").error?.issues[0].message).toBe("Write 5 to 500 characters.");
    expect(schema.safeParse("abcde").success).toBe(true);
    expect(schema.safeParse(`  ${"x".repeat(500)}  `).data).toHaveLength(500);
    expect(schema.safeParse("x".repeat(501)).error?.issues[0].message).toBe("Write 5 to 500 characters.");
  });

  it("the counter: amber from 450, Save allowed only from 5 to 500", () => {
    expect(REMARKS_MIN).toBe(5);
    expect(REMARKS_MAX).toBe(500);
    expect(REMARKS_HELP).toBe("At least 5 characters, up to 500.");
    expect(remarksCounter("abcd")).toEqual({ count: 4, warn: false, over: false, ok: false });
    expect(remarksCounter("  abcde  ")).toMatchObject({ count: 5, ok: true });
    expect(remarksCounter("x".repeat(449))).toMatchObject({ warn: false, ok: true });
    expect(remarksCounter("x".repeat(450))).toMatchObject({ warn: true, ok: true });
    expect(remarksCounter("x".repeat(501))).toMatchObject({ warn: true, over: true, ok: false });
  });
});

describe("Journey: two entries per hold", () => {
  it("Put on hold · reason · remarks · by · date and time; Resumed · remarks · by · date and time · was on hold for", () => {
    expect(journeyHoldStarted({ reason: "Other", note: "No Available DP", raisedBy: "Test Loan Associate", raisedAt }))
      .toBe("Put on hold · Other · No Available DP · by Test Loan Associate · Nov 7, 2026, 2:32 PM PHT");
    expect(journeyHoldResumed({ raisedAt, resumedAt: now, resumedBy: "Test Loan Associate", resumeNote: "A DP is free now" }))
      .toBe("Resumed · A DP is free now · by Test Loan Associate · Nov 8, 2026, 2:40 PM PHT · was on hold for 1 day");
    expect(journeyHoldStarted({ reason: "Other", note: "", raisedBy: "Ana", raisedAt })).toContain(NO_DETAILS);
  });
});

describe("HoldSummary (rendered)", () => {
  const hold = { holdId: "h1", reason: "Other", note: "No Available DP", raisedBy: "Test Loan Associate", raisedAt: raisedAt.toISOString(), owner: "Test Loan Associate" };
  const render = async (p: Record<string, unknown>) => {
    const { HoldSummary } = await import("@/components/jobs/hold-summary");
    return renderToStaticMarkup(createElement(HoldSummary, { hold, now: now.toISOString(), canResume: true, canAddDetails: false, ...p } as never));
  };

  it("shows the category and the remarks, who and when, how to continue and Resume", async () => {
    const html = await render({ txnName: "Mortgage", clockNote: true });
    expect(html).toContain("On hold: Other");
    expect(html).toMatch(/<blockquote[^>]*data-remarks[^>]*>No Available DP<\/blockquote>/);
    expect(html).toContain("Put on hold by Test Loan Associate · Nov 7, 2026, 2:32 PM PHT · 1 day ago");
    expect(html).toContain(TO_CONTINUE);
    expect(html).toContain(CLOCK_NOTE);
    expect(html).toContain("Resume");
    // Soft: a white card with an amber stripe, never a filled navy block.
    expect(html).toContain("hold-card");
    expect(html).not.toMatch(/(?<![:\w-])bg-navy(?![\w/-])/); // the dialog backdrop (backdrop:bg-navy/40) is not a fill
  });

  it("an older hold without remarks: the fallback, and Add details for those allowed", async () => {
    const none = { ...hold, note: "" };
    const allowed = renderToStaticMarkup(createElement((await import("@/components/jobs/hold-summary")).HoldSummary, { hold: none, now: now.toISOString(), canResume: false, canAddDetails: true }));
    expect(allowed).toContain(NO_DETAILS);
    expect(allowed).toContain("Add details");
    expect(allowed).not.toMatch(/data-resume="/); // no live Resume button (only the disabled one)
    const other = renderToStaticMarkup(createElement((await import("@/components/jobs/hold-summary")).HoldSummary, { hold: none, now: now.toISOString(), canResume: false, canAddDetails: false }));
    expect(other).toContain(NO_DETAILS);
    expect(other).not.toContain("Add details");
    // Anyone but the holder: Resume is there but disabled, with "Only {name} can resume this."
    expect(other).toMatch(/<button[^>]*disabled=""[^>]*data-resume-disabled/);
    expect(other).toContain("Needs to be resumed by Test Loan Associate. Ask your supervisor if Test Loan Associate is away.");
    expect(other).not.toContain("Transfer hold");
    const sup = renderToStaticMarkup(createElement((await import("@/components/jobs/hold-summary")).HoldSummary, { hold, now: now.toISOString(), canResume: false, canAddDetails: false, transfer: { candidates: [{ id: "u2", name: "Second LA" }] } }));
    expect(sup).toContain("Transfer hold");
    expect(sup).toContain("Only Test Loan Associate can resume this.");
    expect(sup).not.toContain("data-resume=");
  });
});
