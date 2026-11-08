import { describe, expect, it } from "vitest";
import {
  ADMIN_PERMISSIONS, ALL_PERMISSIONS, PERMISSIONS as P, PERMISSION_GROUPS, ROLE_DEFAULTS, WORKFLOW_PERMISSIONS,
  dependentsOf, normalizePermissions, plainWords, withRequirements,
} from "./permissions";
import { effectivePermissions, maySignIn } from "./access";

/** The seeded roles before this change (old coarse keys), copied from the previous seed. */
const OLD: Record<string, string[]> = {
  LA: ["loans:view", "loans:search", "loans:open", "workflow:la", "notifications:view"],
  ADMIN: ["loans:view", "loans:view_all", "loans:search", "loans:export", "rules:override", "admin:users", "admin:settings", "audit:view", "simulator:use", "notifications:view"],
  DP: ["loans:view", "workflow:dp"],
  FIN: ["loans:view", "workflow:fin"],
  VAULT: ["loans:view", "workflow:vault"],
  DIG: ["loans:view", "workflow:dig"],
  QA: ["loans:view", "workflow:qa"],
  APPR: ["loans:view", "workflow:appr"],
};

/** Each old check → the new keys that now make the same decision. */
const OLD_TO_NEW: Record<string, string[]> = {
  "loans:view": [P.LOANS_VIEW],
  "loans:search": [P.LOANS_SEARCH],
  "loans:open": [P.LOANS_OPEN],
  "loans:export": [P.LOANS_EXPORT],
  "rules:override": [P.RULES_OVERRIDE],
  "audit:view": [P.AUDIT_VIEW],
  "simulator:use": [P.SIMULATOR_USE],
  "workflow:la": [P.CHECKLIST_TICK, P.LABELS_PRINT, P.TXN_ADD, P.TXN_COMPLETE, P.DP_SEND, P.RETURNS_ACCEPT],
  "workflow:dp": [P.DP_RECEIVE],
  "admin:users": [P.USERS_VIEW, P.USERS_EDIT],
  "admin:settings": [P.SETTINGS_BRANCHES, P.SETTINGS_LOAN_TYPES, P.SETTINGS_TRANSACTION_TYPES, P.SETTINGS_DOCUMENT_TYPES, P.SETTINGS_CHECKLIST, P.SETTINGS_TAT, P.SETTINGS_HOLIDAYS, P.SETTINGS_CASH_ADVANCE, P.SETTINGS_LTO, P.SETTINGS_SYSTEM, P.SETTINGS_IMPORT, P.TESTDATA_RESET],
};

describe("can() for each seeded role matches the previous behaviour", () => {
  it.each(Object.keys(OLD))("%s", (key) => {
    const def = ROLE_DEFAULTS[key];
    const now = effectivePermissions({ key, builtIn: true, permissions: def.permissions });
    for (const [oldKey, newKeys] of Object.entries(OLD_TO_NEW)) {
      for (const k of newKeys) expect([key, oldKey, k, now.has(k as never)]).toEqual([key, oldKey, k, OLD[key].includes(oldKey)]);
    }
    // "see every branch" became Branch access.
    // Finance now sees all branches (funds approvals); everyone else as before.
    expect(def.branchAccess === "ALL").toBe(OLD[key].includes("loans:view_all") || key === "FIN");
  });

  it("Admin is locked: every permission except the loan-file steps, whatever is stored", () => {
    const admin = effectivePermissions({ key: "ADMIN", builtIn: true, permissions: [] });
    expect([...admin].sort()).toEqual([...ADMIN_PERMISSIONS].sort());
    for (const k of WORKFLOW_PERMISSIONS) expect(admin.has(k)).toBe(false);
    expect(admin.has(P.ROLES_MANAGE)).toBe(true);
    // A custom role called ADMIN is not locked.
    expect(effectivePermissions({ key: "ADMIN", builtIn: false, permissions: [P.LOANS_VIEW] }).size).toBe(1);
  });

  it("every key is in exactly one group, and unknown keys grant nothing", () => {
    const keys = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(effectivePermissions({ key: "X", builtIn: false, permissions: ["workflow:la", "admin:settings"] }).size).toBe(0);
  });
});

describe("Dependencies", () => {
  it("turning on Send to a processor turns on Tick papers and See loan files", () => {
    expect([...withRequirements([P.DP_SEND])].sort()).toEqual([P.CHECKLIST_TICK, P.LOANS_VIEW, P.DP_SEND].sort());
    expect(normalizePermissions([P.LABELS_PRINT, "nonsense"])).toEqual([P.LOANS_VIEW, P.CHECKLIST_TICK, P.LABELS_PRINT]);
  });
  it("turning off Tick papers turns off what needs it; turning off Find a loan turns off Open a loan file", () => {
    expect(dependentsOf(P.CHECKLIST_TICK).sort()).toEqual([P.LABELS_PRINT, P.TXN_ADD, P.TXN_COMPLETE, P.DP_SEND, P.FUNDS_FLAG].sort());
    expect(dependentsOf(P.LOANS_SEARCH)).toEqual([P.LOANS_OPEN]);
    expect(dependentsOf(P.LOANS_VIEW)).toContain(P.DP_SEND);
  });
});

describe("In plain words", () => {
  it("summarises the switches", () => {
    const w = plainWords([P.LOANS_VIEW, P.LOANS_SEARCH, P.LOANS_OPEN, P.CHECKLIST_TICK, P.DP_SEND], "ASSIGNED");
    expect(w).toContain("Can see loan files, find loans and open new loan files in assigned branches.");
    expect(w).toContain("Can tick papers.");
    expect(w).toContain("Can send to a processor.");
    expect(w).toContain("Cannot change Settings.");
    expect(plainWords([], "ALL")).toContain("Cannot see loan files.");
  });
});

describe("Sign-in rule", () => {
  const user = { active: true, isTestUser: true };
  it("built-in roles: outside test mode only Admin and Loan Associate; in test mode test users may use DP or Finance", () => {
    expect(maySignIn(user, { builtIn: true, active: true, canSignIn: true }, false)).toBe(true);
    expect(maySignIn(user, { builtIn: true, active: true, canSignIn: false }, false)).toBe(false);
    expect(maySignIn(user, { builtIn: true, active: true, canSignIn: false }, true)).toBe(true);
    expect(maySignIn({ active: true, isTestUser: false }, { builtIn: true, active: true, canSignIn: false }, true)).toBe(false);
  });
  it("custom roles: test users only, test mode only, active role only", () => {
    const custom = { builtIn: false, active: true, canSignIn: false };
    expect(maySignIn(user, custom, true)).toBe(true);
    expect(maySignIn(user, custom, false)).toBe(false);
    expect(maySignIn({ active: true, isTestUser: false }, custom, true)).toBe(false);
    expect(maySignIn(user, { ...custom, active: false }, true)).toBe(false);
    expect(maySignIn({ active: false, isTestUser: true }, custom, true)).toBe(false);
  });
});

describe("Funds, jobs and problems permissions", () => {
  it("Admin is locked out of LA, DP and Finance work steps but sees funds, resolves any problem and owns the TAT report", () => {
    const p = new Set(ADMIN_PERMISSIONS);
    for (const k of [P.FUNDS_FLAG, P.FUNDS_REQUEST, P.FUNDS_LIQUIDATE, P.FUNDS_APPROVE, P.FUNDS_RELEASE, P.JOBS_WORK, P.PROBLEMS_RAISE]) {
      expect(p.has(k)).toBe(false);
    }
    for (const k of [P.FUNDS_VIEW_ALL, P.PROBLEMS_RESOLVE_ANY, P.PROBLEMS_OUTSIDE, P.REPORTS_TAT, P.SETTINGS_PROBLEM_REASONS]) {
      expect(p.has(k)).toBe(true);
    }
  });
  it("defaults: the LA flags, the DP works and requests, Finance approves and releases", () => {
    expect(ROLE_DEFAULTS.LA.permissions).toEqual(expect.arrayContaining([P.FUNDS_FLAG, P.PROBLEMS_RAISE, P.PROBLEMS_RESOLVE]));
    expect(ROLE_DEFAULTS.DP.permissions).toEqual(expect.arrayContaining([P.JOBS_WORK, P.FUNDS_REQUEST, P.FUNDS_LIQUIDATE]));
    expect(ROLE_DEFAULTS.DP.permissions).not.toContain(P.FUNDS_APPROVE);
    expect(ROLE_DEFAULTS.FIN.permissions).toEqual(expect.arrayContaining([P.FUNDS_APPROVE, P.FUNDS_RELEASE, P.FUNDS_EXCEPTION]));
    expect(ROLE_DEFAULTS.FIN.permissions).not.toContain(P.FUNDS_REQUEST);
  });
});

describe("Pasuyo permission", () => {
  it("jobs:pasuyo is a DP work step: the DP has it, Admin never does, the LA does not", () => {
    expect(ROLE_DEFAULTS.DP.permissions).toContain(P.JOBS_PASUYO);
    expect(ADMIN_PERMISSIONS).not.toContain(P.JOBS_PASUYO);
    expect(WORKFLOW_PERMISSIONS).toContain(P.JOBS_PASUYO);
    expect(ROLE_DEFAULTS.LA.permissions).not.toContain(P.JOBS_PASUYO);
    expect([...withRequirements([P.JOBS_PASUYO])]).toEqual(expect.arrayContaining([P.JOBS_WORK]));
  });
});

describe("Holds and Journey amounts permissions", () => {
  it("holds are work steps: LA and DP raise and resume; Admin only resumes any; plain labels under Holds", () => {
    expect(ROLE_DEFAULTS.LA.permissions).toEqual(expect.arrayContaining([P.HOLDS_RAISE, P.HOLDS_RESOLVE]));
    expect(ROLE_DEFAULTS.DP.permissions).toEqual(expect.arrayContaining([P.HOLDS_RAISE, P.HOLDS_RESOLVE]));
    expect(WORKFLOW_PERMISSIONS).toEqual(expect.arrayContaining([P.HOLDS_RAISE, P.HOLDS_RESOLVE]));
    expect(ADMIN_PERMISSIONS).not.toContain(P.HOLDS_RAISE);
    expect(ADMIN_PERMISSIONS).toContain(P.HOLDS_TRANSFER);
    expect(ROLE_DEFAULTS.FIN.permissions).toContain(P.HOLDS_TRANSFER);
    expect(ALL_PERMISSIONS as readonly string[]).not.toContain("holds:resolve_any");
    expect(ADMIN_PERMISSIONS).toContain(P.HOLDS_MANAGE);
  });
  it("cash amounts in the Journey: Finance, Approvers and Admin by default; a normal switch under Funds", () => {
    expect(ROLE_DEFAULTS.FIN.permissions).toContain(P.JOURNEY_VIEW_AMOUNTS);
    expect(ROLE_DEFAULTS.APPR.permissions).toContain(P.JOURNEY_VIEW_AMOUNTS);
    expect(ADMIN_PERMISSIONS).toContain(P.JOURNEY_VIEW_AMOUNTS);
    for (const k of ["LA", "DP", "VAULT", "DIG", "QA"]) expect(ROLE_DEFAULTS[k].permissions).not.toContain(P.JOURNEY_VIEW_AMOUNTS);
  });
});

describe("Return to LA permission", () => {
  it("jobs:return_to_la is a DP work step: the DP has it, not Admin, not the LA", () => {
    expect(ROLE_DEFAULTS.DP.permissions).toContain(P.JOBS_RETURN_TO_LA);
    expect(ADMIN_PERMISSIONS).not.toContain(P.JOBS_RETURN_TO_LA);
    expect(ROLE_DEFAULTS.LA.permissions).not.toContain(P.JOBS_RETURN_TO_LA);
    expect(ADMIN_PERMISSIONS).toContain(P.SETTINGS_RETURN_REASONS);
  });
});
