import { describe, expect, it } from "vitest";
import { DECLINE_REASONS, currentRound, inactiveSenderNote, sentBackIsFor, roundChip, roundEntries, roundNumbers, sentBack, type AssignmentLike } from "./rounds";

const t = (d: string) => new Date(`2026-11-0${d}Z`);
const A = (p: Partial<AssignmentLike> & { id: string }): AssignmentLike => ({
  status: "PENDING_ACCEPTANCE", endorsedAt: t("2T01:00:00"), assignedById: "la-1", assignedBy: { name: "Ana Cruz" }, dpUser: { name: "Grace Tan" },
  decidedAt: null, returnedAt: null, closedAt: null, declineReasons: null, returnReasons: null, ...p,
});

describe("Rounds: decline and return go back to the sender; sending again starts a new round", () => {
  const declined = A({ id: "a1", status: "DECLINED", decidedAt: t("2T03:00:00"), closedAt: t("2T03:00:00"), declineReasons: "No capacity: full this week" });
  const pulled = A({ id: "a0", status: "PULLED_BACK", endorsedAt: t("1T01:00:00"), closedAt: t("1T02:00:00") });
  const returned = A({ id: "a2", status: "WITHDRAWN", endorsedAt: t("3T01:00:00"), decidedAt: t("3T02:00:00"), returnedAt: t("4T01:00:00"), returnReasons: "Missing paper (OR): not in the folder", dpUser: { name: "Paolo Lim" } });
  const third = A({ id: "a3", endorsedAt: t("5T01:00:00"), dpUser: { name: "Joy Navarro" } });

  it("the decline reasons list", () => {
    expect(DECLINE_REASONS).toEqual(["No capacity", "Wrong job for me", "Papers not complete", "Other"]);
  });

  it("a pull back is not a new round; each decline or return is", () => {
    const rounds = roundNumbers([third, returned, declined, pulled]);
    expect([...rounds.entries()]).toEqual([["a0", 1], ["a1", 1], ["a2", 2], ["a3", 3]]);
    expect(currentRound([pulled])).toBe(1);
    expect(currentRound([pulled, declined])).toBe(2); // the next send is round 2
    expect(roundChip([pulled, declined])).toBeNull(); // the chip shows once it is sent again
    expect(roundChip([declined, third])).toBe("Round 2");
    expect(roundChip([pulled])).toBeNull();
  });

  it("sent back: the sender, the DP, when, the findings and the round", () => {
    expect(sentBack("RETURNED", [pulled, declined])).toEqual({
      kind: "declined", label: "Declined by the DP", dpName: "Grace Tan", at: t("2T03:00:00"), findings: "No capacity: full this week",
      senderId: "la-1", senderName: "Ana Cruz", senderActive: true, round: 1,
    });
    // An inactive sender: it is for every active LA of the branch, with a note.
    const gone = sentBack("RETURNED", [{ ...declined, assignedBy: { name: "Ana Cruz", active: false } }])!;
    expect(sentBackIsFor(gone, { id: "la-2", isBranchLa: true })).toBe(true);
    expect(sentBackIsFor(gone, { id: "la-3", isBranchLa: false })).toBe(false);
    expect(inactiveSenderNote(gone)).toBe("Sender Ana Cruz is inactive");
    const active = sentBack("RETURNED", [declined])!;
    expect(sentBackIsFor(active, { id: "la-2", isBranchLa: true })).toBe(false);
    expect(sentBackIsFor(active, { id: "la-1", isBranchLa: false })).toBe(true);
    expect(inactiveSenderNote(active)).toBeNull();
    expect(sentBack("RETURNED", [pulled, declined, returned])).toMatchObject({ kind: "returned", label: "Returned by the DP: fix and send again", dpName: "Paolo Lim", round: 2 });
    // Sent again: no longer "sent back".
    expect(sentBack("ASSIGNED", [declined, returned, third])).toBeNull();
    // Pulled back by the LA is not a decline.
    expect(sentBack("READY", [pulled])).toBeNull();
  });

  it("the Journey per round: Sent, Declined by DP, Sent again, Returned by DP, Sent again", () => {
    const rows = roundEntries([third, returned, declined], t("5T03:00:00"));
    expect(rows.map((r) => [r.round, r.sentText, r.dpName, r.outcome])).toEqual([
      [1, "Sent", "Grace Tan", "Declined by DP"],
      [2, "Sent again", "Paolo Lim", "Returned by DP"],
      [3, "Sent again", "Joy Navarro", "Waiting to accept"],
    ]);
    expect(rows[0]).toMatchObject({ findings: "No capacity: full this week", duration: "2 hours", outcomeAt: t("2T03:00:00") });
    expect(rows[1]).toMatchObject({ findings: "Missing paper (OR): not in the folder", duration: "1 day" });
    expect(rows[2]).toMatchObject({ outcomeAt: null, duration: "2 hours" });
    // Papers handed over and confirmed back, inside the round.
    const withPapers = roundEntries([{ ...returned, papersHandedAt: t("4T01:00:00"), papersReceivedAt: t("4T03:00:00"), papersReceivedBy: "Ana Cruz" }]);
    expect(withPapers[0].papers).toEqual(["Papers handed over by Paolo Lim · Nov 4, 2026, 9:00 AM PHT", "Papers received by Ana Cruz · Nov 4, 2026, 11:00 AM PHT"]);
  });
});
