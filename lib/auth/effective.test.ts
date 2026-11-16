import { describe, expect, it } from "vitest";
import { PERMISSIONS as P } from "./permissions";
import { CA_KEYS, FT_KEYS, keySource, userPermissions } from "./effective";

const both = { handlesCa: true, handlesFt: true };
const none = { handlesCa: false, handlesFt: false };

describe("userPermissions: role ticks + grants - denies, then fund-type ticks (D-008, D-009)", () => {
  it("inherits the role's ticks", () => {
    expect(userPermissions([P.LOANS_VIEW, P.CHECKLIST_TICK], [], none)).toEqual(new Set([P.LOANS_VIEW, P.CHECKLIST_TICK]));
  });

  it("a GRANT adds a key the role lacks, with what it requires", () => {
    const s = userPermissions([P.LOANS_VIEW], [{ key: P.LOANS_REFRESH, effect: "GRANT" }], none);
    expect(s.has(P.LOANS_REFRESH)).toBe(true);
    expect(s.has(P.MYLOANS_VIEW)).toBe(true); // Refresh requires "See when MyLoans was last checked"
  });

  it("a DENY removes a key the role has, and everything that needs it", () => {
    const s = userPermissions([P.LOANS_VIEW, P.MYLOANS_VIEW, P.LOANS_REFRESH], [{ key: P.MYLOANS_VIEW, effect: "DENY" }], none);
    expect(s.has(P.MYLOANS_VIEW)).toBe(false);
    expect(s.has(P.LOANS_REFRESH)).toBe(false);
    expect(s.has(P.LOANS_VIEW)).toBe(true);
  });

  it("DENY wins over the role and over a GRANT of a key that needs it", () => {
    const s = userPermissions([P.USERS_VIEW], [{ key: P.USERS_EDIT, effect: "GRANT" }, { key: P.USERS_VIEW, effect: "DENY" }], none);
    expect(s.has(P.USERS_VIEW)).toBe(false);
    expect(s.has(P.USERS_EDIT)).toBe(false);
  });

  it("unknown keys are ignored; renamed keys are mapped", () => {
    expect(userPermissions(["no:such_key"], [{ key: "also:unknown", effect: "GRANT" }], none).size).toBe(0);
  });

  it("the per-type funds keys count only for a ticked type", () => {
    const role = [...CA_KEYS, ...FT_KEYS, P.LOANS_VIEW];
    expect([...userPermissions(role, [], none)]).toEqual([P.LOANS_VIEW]);
    const ca = userPermissions(role, [], { handlesCa: true, handlesFt: false });
    expect(CA_KEYS.every((k) => ca.has(k))).toBe(true);
    expect(FT_KEYS.some((k) => ca.has(k))).toBe(false);
    const all = userPermissions(role, [], both);
    expect([...CA_KEYS, ...FT_KEYS].every((k) => all.has(k))).toBe(true);
  });

  it("a GRANT of a funds key still needs the type ticked", () => {
    expect(userPermissions([], [{ key: P.FUNDS_CA_APPROVE, effect: "GRANT" }], none).has(P.FUNDS_CA_APPROVE)).toBe(false);
    expect(userPermissions([], [{ key: P.FUNDS_CA_APPROVE, effect: "GRANT" }], { handlesCa: true, handlesFt: false }).has(P.FUNDS_CA_APPROVE)).toBe(true);
  });
});

describe("keySource (the user screen: Inherited / Granted / Denied)", () => {
  it.each([
    [[P.LOANS_VIEW], [], "INHERITED"],
    [[], [], "NONE"],
    [[], [{ key: P.LOANS_VIEW, effect: "GRANT" as const }], "GRANTED"],
    [[P.LOANS_VIEW], [{ key: P.LOANS_VIEW, effect: "DENY" as const }], "DENIED"],
  ])("%o %o -> %s", (role, overrides, want) => {
    expect(keySource(P.LOANS_VIEW, role, overrides)).toBe(want);
  });
});
