import { describe, expect, it } from "vitest";
import {
  ADMIN_PERMISSIONS, ALL_PERMISSIONS, PERMISSIONS as P, PERMISSION_DEFS, PERMISSION_GROUPS, RENAMED_PERMISSIONS, ROLE_DEFAULTS, WORKFLOW_PERMISSIONS,
  changesOf, dependentsOf, normalizePermissions, plainWords, viewOf, withRequirements,
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
  "admin:settings": [P.BRANCHES_MANAGE, P.SETTINGS_LOAN_TYPES, P.SETTINGS_TRANSACTION_TYPES, P.SETTINGS_DOCUMENT_TYPES, P.SETTINGS_CHECKLIST, P.SETTINGS_TAT, P.SETTINGS_HOLIDAYS, P.SETTINGS_CASH_ADVANCE, P.SETTINGS_LTO, P.SETTINGS_SYSTEM, P.SETTINGS_IMPORT, P.TESTDATA_RESET],
};

describe("can() for each seeded role matches the previous behaviour", () => {
  it.each(Object.keys(OLD))("%s", (key) => {
    const def = ROLE_DEFAULTS[key];
    const now = effectivePermissions({ permissions: def.permissions });
    for (const [oldKey, newKeys] of Object.entries(OLD_TO_NEW)) {
      for (const k of newKeys) expect([key, oldKey, k, now.has(k as never)]).toEqual([key, oldKey, k, OLD[key].includes(oldKey)]);
    }
    // "see every branch" became Branch access.
    // Finance now sees all branches (funds approvals); everyone else as before.
    expect(def.branchAccess === "ALL").toBe(OLD[key].includes("loans:view_all") || key === "FIN");
  });

  it("Admin is an ordinary role: it grants exactly its stored ticks (default: everything except the loan-file steps)", () => {
    expect(effectivePermissions({ permissions: [] }).size).toBe(0);
    expect(effectivePermissions({ permissions: [P.LOANS_VIEW] }).size).toBe(1);
    const admin = effectivePermissions({ permissions: ROLE_DEFAULTS.ADMIN.permissions });
    expect([...admin].sort()).toEqual([...ADMIN_PERMISSIONS].sort());
    for (const k of WORKFLOW_PERMISSIONS) expect(admin.has(k)).toBe(false);
    expect(admin.has(P.ROLES_MANAGE)).toBe(true);
    expect(admin.has(P.ACCESS_MANAGE)).toBe(true);
  });

  it("old key names still grant their new key (stored before the migration)", () => {
    expect([...effectivePermissions({ permissions: ["source:review", "source:manage", "settings:branches"] })].sort())
      .toEqual([P.SOURCE_REVIEW, P.SOURCE_MANAGE, P.BRANCHES_MANAGE].sort());
    expect(Object.keys(RENAMED_PERMISSIONS).sort()).toEqual(["settings:branches", "source:manage", "source:review"]);
    expect(normalizePermissions(["settings:branches"])).toEqual([P.BRANCHES_VIEW, P.BRANCHES_MANAGE].filter((k) => ALL_PERMISSIONS.includes(k)).sort((a, b) => ALL_PERMISSIONS.indexOf(a) - ALL_PERMISSIONS.indexOf(b)));
  });

  it("every key is in exactly one group, and unknown keys grant nothing", () => {
    const keys = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(effectivePermissions({ permissions: ["workflow:la", "admin:settings"] }).size).toBe(0);
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
    expect(w).toContain("Can see loan files, find loans and open new loan files in the branches of their own access.");
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

describe("The catalogue (Settings > Roles)", () => {
  it("has the plain groups, in order, and every tick has a label, a help line, where and what it was", () => {
    expect(PERMISSION_GROUPS.map((g) => g.label)).toEqual([
      "Loans", "Transactions and papers", "Send to DP and returns", "DP work", "Funds", "Monitoring", "Reports",
      "MyLoans and sync", "Branches and access", "Settings and Admin", "Email",
    ]);
    for (const d of PERMISSION_DEFS) {
      expect([d.key, !!d.label && !d.label.includes(":")]).toEqual([d.key, true]);
      expect([d.key, d.help.length > 10, !!d.where, !!d.was]).toEqual([d.key, true, true, true]);
    }
  });

  it("View / Change pairs: the Change needs its View, both in the same group", () => {
    const pairs = PERMISSION_DEFS.filter((d) => d.view).map((d) => [d.view, d.key]);
    expect(pairs).toEqual(expect.arrayContaining([
      [P.MYLOANS_VIEW, P.LOANS_REFRESH], [P.BRANCHES_VIEW, P.BRANCHES_MANAGE], [P.USERS_VIEW, P.USERS_EDIT],
      [P.EMAIL_VIEW, P.EMAIL_MANAGE], [P.REPORTS_TAT, P.REPORTS_TAT_EXPORT], [P.MONITOR_LTO, P.LTO_REPORTS_MANAGE],
    ]));
    for (const [view, change] of pairs) {
      expect(withRequirements([change!])).toContain(view);
      expect(dependentsOf(view!)).toContain(change);
      expect(viewOf(change!)).toBe(view);
      expect(changesOf(view!)).toContain(change);
      const g = (k: string) => PERMISSION_GROUPS.find((x) => x.items.some((i) => i.key === k))!.key;
      expect(g(view!)).toBe(g(change!));
    }
  });

  it("Refresh a loan from MyLoans: everyone who saw the button keeps it; Finance, Approvers and the Monitor do not", () => {
    for (const k of ["LA", "ADMIN", "DP", "VAULT", "DIG", "QA"]) expect([k, ROLE_DEFAULTS[k].permissions.includes(P.LOANS_REFRESH)]).toEqual([k, true]);
    for (const k of ["FIN", "APPR", "MONITOR"]) expect([k, ROLE_DEFAULTS[k].permissions.includes(P.LOANS_REFRESH)]).toEqual([k, false]);
    // The "Last checked" line stays for everyone who sees loan files.
    for (const [k, d] of Object.entries(ROLE_DEFAULTS)) expect([k, d.permissions.includes(P.MYLOANS_VIEW)]).toEqual([k, d.permissions.includes(P.LOANS_VIEW)]);
  });

  it("admin-only things stay on Admin only by default", () => {
    const adminOnly = [P.ROLES_MANAGE, P.ACCESS_MANAGE, P.USERS_EDIT, P.BRANCHES_MANAGE, P.BRANCHES_IMPORT, P.BRANCHES_REVIEW, P.SOURCE_MANAGE, P.MYLOANS_SYNC, P.SOURCE_REVIEW, P.SETTINGS_PN_FORMAT, P.EMAIL_MANAGE, P.EMAIL_VIEW, P.REPORTS_TAT_EXPORT];
    for (const k of adminOnly) {
      expect([k, ADMIN_PERMISSIONS.includes(k)]).toEqual([k, true]);
      for (const [r, d] of Object.entries(ROLE_DEFAULTS)) if (r !== "ADMIN") expect([r, k, d.permissions.includes(k)]).toEqual([r, k, false]);
    }
    // Only the Operations Monitor is told about LTO advisories.
    expect(ADMIN_PERMISSIONS).not.toContain(P.LTO_REPORTS_NOTIFY);
    expect(ROLE_DEFAULTS.MONITOR.permissions).toContain(P.LTO_REPORTS_NOTIFY);
  });
});
