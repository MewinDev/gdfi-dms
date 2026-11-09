import { describe, expect, it } from "vitest";
import { checkRelease, defaultFundsType, fundsTypeLabel, isTransfer, last4Refusal, pillTone, releaseLine, releaseVerb, SEEDED_FUNDS_TYPES, typeChangeRemarks } from "./types";
import { csvCell, fundsCsv, FUNDS_CSV_HEADER } from "./export";

const CA = { needsReference: false, needsAccount: false };
const FT = { needsReference: true, needsAccount: true };

describe("Funds types (pure rules)", () => {
  it("seeds Cash advance (CA) and Fund transfer (FT) with the agreed switches", () => {
    expect(SEEDED_FUNDS_TYPES.map((t) => [t.code, t.name, t.needsReference, t.needsAccount, t.mustLiquidate])).toEqual([
      ["CA", "Cash advance", false, false, true],
      ["FT", "Fund transfer", true, true, true],
    ]);
  });

  it("labels, words and the pill colour", () => {
    expect(fundsTypeLabel({ code: "FT", name: "Fund transfer" })).toBe("FT · Fund transfer");
    expect(releaseVerb(CA)).toBe("Release cash");
    expect(releaseVerb(FT)).toBe("Send transfer");
    expect(isTransfer({ needsReference: false, needsAccount: true })).toBe(true);
    expect(pillTone("CA")).toBe("ca");
    expect(pillTone("FT")).toBe("ft");
    expect(pillTone("CHK")).toBe("ft");
  });

  it("the default type is Cash advance when active, otherwise the first active one", () => {
    const types = [{ code: "FT", active: true }, { code: "CA", active: true }];
    expect(defaultFundsType(types)?.code).toBe("CA");
    expect(defaultFundsType([{ code: "FT", active: true }, { code: "CA", active: false }])?.code).toBe("FT");
    expect(defaultFundsType([{ code: "CA", active: false }])).toBeNull();
  });

  it("Cash advance release stays as it was: the reference note only", () => {
    expect(checkRelease(CA, { ref: "V-1" })).toEqual({ ok: true, details: { ref: "V-1", transferDate: "", accountProvider: "", accountName: "", accountLast4: "" } });
    expect(checkRelease(CA, { ref: "" })).toMatchObject({ ok: false, field: "ref", message: "Add a reference note (voucher or transfer number)." });
    // Account fields sent anyway are not stored for a type that does not need them.
    expect(checkRelease(CA, { ref: "V-1", accountLast4: "1234", accountProvider: "BPI" })).toMatchObject({ ok: true, details: { accountLast4: "", accountProvider: "" } });
  });

  it("Fund transfer release needs the reference number, the date and the receiving account", () => {
    const full = { ref: "FT-889101", transferDate: "2026-11-09", accountProvider: "BPI", accountName: "Joy Navarro", accountLast4: "4821" };
    expect(checkRelease(FT, full)).toEqual({ ok: true, details: full });
    expect(checkRelease(FT, { ...full, ref: "F1" })).toMatchObject({ ok: false, field: "ref" });
    expect(checkRelease(FT, { ...full, transferDate: "" })).toMatchObject({ ok: false, field: "transferDate" });
    expect(checkRelease(FT, { ...full, accountProvider: "" })).toMatchObject({ ok: false, field: "accountProvider" });
    expect(checkRelease(FT, { ...full, accountName: " " })).toMatchObject({ ok: false, field: "accountName" });
    expect(checkRelease(FT, { ...full, accountLast4: "" })).toMatchObject({ ok: false, field: "accountLast4" });
  });

  it("last 4 digits only: a full account number is refused, never stored", () => {
    expect(last4Refusal("4821")).toBeNull();
    expect(last4Refusal("48 21")).toBeNull();
    expect(last4Refusal("001234567890")).toBe("Enter only the last 4 digits. The full account number is never stored.");
    expect(last4Refusal("12345")).toMatch(/only the last 4/);
    expect(last4Refusal("12a4")).toBe("Enter the last 4 digits (numbers only).");
    expect(last4Refusal("123")).toBe("Enter the last 4 digits (numbers only).");
    const r = checkRelease(FT, { ref: "FT-1234", transferDate: "2026-11-09", accountProvider: "BPI", accountName: "Joy", accountLast4: "001234567890" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("001234567890");
  });

  it("changing the type needs remarks of 5 to 500 characters", () => {
    expect(typeChangeRemarks.safeParse("Sent to the bank").success).toBe(true);
    expect(typeChangeRemarks.safeParse("abc").success).toBe(false);
    expect(typeChangeRemarks.safeParse("x".repeat(501)).success).toBe(false);
  });

  it("the release line shows the account ending only", () => {
    expect(releaseLine({ releaseRef: "FT-1", transferDate: "2026-11-09", accountProvider: "GCash", accountName: "Joy", accountLast4: "4821" })).toBe("Ref FT-1 · sent 2026-11-09 · to GCash, Joy, account ending 4821");
    expect(releaseLine({ releaseRef: "V-1", transferDate: "", accountProvider: "", accountName: "", accountLast4: "" })).toBe("Ref V-1");
  });
});

describe("Funds CSV", () => {
  const row = {
    number: "CA-2026-0001", typeCode: "FT", typeName: "Fund transfer", status: "RELEASED", processor: "Joy", branch: "Quezon City",
    requestedCents: 350_000, approvedCents: 350_000, releasedCents: 350_000, receiptCents: 100_000, returnedCents: 0, releasedOn: "2026-11-09",
    releaseRef: "FT-1", transferDate: "2026-11-09", accountProvider: "BPI", accountName: "Joy", accountLast4: "4821", liquidateBy: "2026-11-23", cashToSettle: false, lines: "LTO fee PN-0001003 Mortgage",
  };
  it("has a Type column and the account ending only", () => {
    expect(FUNDS_CSV_HEADER.slice(0, 3)).toEqual(["Number", "Type", "Type name"]);
    const [head, line] = fundsCsv([row]).split("\r\n");
    expect(head).toBe(FUNDS_CSV_HEADER.join(","));
    expect(line.startsWith("CA-2026-0001,FT,Fund transfer,RELEASED,")).toBe(true);
    expect(line).toContain("\"BPI, Joy, ending 4821\"");
    expect(line).toContain("\"₱2,500.00\""); // balance
  });
  it("cells that look like formulas are made safe", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("a,b")).toBe("\"a,b\"");
  });
});
