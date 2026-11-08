import { describe, expect, it } from "vitest";
import { ltoEstimate, ltoLine } from "./lto";
import { txnStatus } from "./txn-status";
import { SETTINGS_SCHEMAS } from "@/lib/services/admin";

describe("LTO office estimate", () => {
  it("in plain words; no figures: no estimate yet", () => {
    expect(ltoEstimate({ distanceKm: 25, travelHours: 1, suggestedTransportCents: 60000 })).toBe("about 25 km · usually 1 hour · suggested transport ₱600");
    expect(ltoEstimate({ distanceKm: 12.5, travelHours: 1.5, suggestedTransportCents: null })).toBe("about 12.5 km · usually 1.5 hours");
    expect(ltoEstimate({ distanceKm: null, travelHours: null, suggestedTransportCents: null })).toBeNull();
    expect(ltoLine({ name: "LTO Mandaue", distanceKm: null, travelHours: null, suggestedTransportCents: null })).toBe("LTO Mandaue · No estimate yet");
  });

  it("sent work says where: At LTO Mandaue", () => {
    const base = { code: "NOTARY", requiresDp: true, requiredDone: 5, requiredTotal: 5, tickedAny: true, tat: null, problemDays: null, holdDays: null, missingPapers: 0, dpName: "Grace Tan", ltoName: "LTO Mandaue" };
    expect(txnStatus({ ...base, status: "ASSIGNED" }).line).toBe("Sent to Grace Tan · waiting to accept · At LTO Mandaue");
    expect(txnStatus({ ...base, status: "IN_PROCESS" }).line).toBe("With Grace Tan · working on it · At LTO Mandaue");
    expect(txnStatus({ ...base, status: "READY" }).line).not.toContain("LTO");
  });
});

describe("Settings: Needs LTO processing and the office figures", () => {
  const type = { code: "SPA", name: "Special Power of Attorney", ownerRole: "DP", sortOrder: "5" };
  it("needs a processor", () => {
    expect(SETTINGS_SCHEMAS.transactionType.safeParse({ ...type, requiresDp: "on", needsLto: "on" }).success).toBe(true);
    const r = SETTINGS_SCHEMAS.transactionType.safeParse({ ...type, requiresDp: "", needsLto: "on" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/needs a processor/);
    expect(SETTINGS_SCHEMAS.transactionType.parse({ ...type, requiresDp: "on" }).needsLto).toBe(false);
  });
  it("office figures are optional numbers; transport is stored in centavos", () => {
    expect(SETTINGS_SCHEMAS.ltoOffice.parse({ code: "LTO-MAN", name: "LTO Mandaue", distanceKm: "25", travelHours: "1", suggestedTransport: "600" }))
      .toMatchObject({ distanceKm: 25, travelHours: 1, suggestedTransportCents: 60000 });
    expect(SETTINGS_SCHEMAS.ltoOffice.parse({ code: "LTO-MAN", name: "LTO Mandaue", distanceKm: "", travelHours: "", suggestedTransport: "" }))
      .toMatchObject({ distanceKm: null, travelHours: null, suggestedTransportCents: null });
    expect(SETTINGS_SCHEMAS.ltoOffice.safeParse({ code: "LTO-MAN", name: "LTO Mandaue", distanceKm: "far" }).success).toBe(false);
  });
});
