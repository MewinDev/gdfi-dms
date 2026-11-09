/**
 * The split View / Change ticks, both ways, on the server: Branches (import, review, hide), the PN
 * format, MyLoans sync (settings vs Run now), Email (see vs change) and Branch access (users:edit vs
 * access:manage). The UI hides what a person cannot use; these prove the server refuses it anyway.
 * People are the seeded test users with their ticks replaced (the same CurrentUser the app builds).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS as P, type Permission } from "@/lib/auth/permissions";
import { getSetting, setSetting } from "@/lib/settings";
import { ignoreReview, previewBranchFile, confirmBranchFile, runBranchSync, acceptReview, setBranchHidden } from "@/lib/services/branches";
import { savePnFormat } from "@/lib/services/pn-settings";
import { runSyncNow, saveSyncSettings } from "@/lib/services/source-sync";
import { resendEmail, saveEmailTemplate, sendTestEmail, setEmailActive, setEmailEvent } from "@/lib/email/outbox";
import { saveUser } from "@/lib/services/admin";
import { asUser } from "./helpers";

let admin: CurrentUser;
const as = (keys: Permission[]): CurrentUser => ({ ...admin, permissions: new Set<string>(keys) });
/** Refused for the permission (not for another reason). */
const DENIED = /Ask an Admin|does not allow|Only Admin/;
async function refused(p: Promise<unknown>) {
  await expect(p).rejects.toThrow(DENIED);
}
/** Passed the permission check: it may still fail later for another reason (missing row, bad input). */
async function passes(p: Promise<unknown>) {
  try { await p; } catch (e) { expect(String((e as Error).message)).not.toMatch(DENIED); }
}

const CSV = "division,area,code,name,address\nZ Split Division,Z Split Area,871,Z Split Branch,";
const savedPn = { v: null as unknown };
const savedEvents = { v: null as unknown };

beforeAll(async () => {
  admin = await asUser("test.admin@gdfi.ph");
  savedPn.v = await getSetting("pn.format");
  savedEvents.v = await getSetting("email.events");
});
afterAll(async () => {
  await setSetting("pn.format", savedPn.v as never);
  await setSetting("email.events", savedEvents.v as never);
  await prisma.branch.deleteMany({ where: { code: "871" } });
});

describe("Branches: see, change, import, decide", () => {
  it("Import from MyLoans and Branches from MyLoans need branches:import", async () => {
    const viewer = as([P.BRANCHES_VIEW, P.BRANCHES_MANAGE, P.BRANCHES_REVIEW]);
    await refused(previewBranchFile(viewer, CSV, "z.csv"));
    await refused(confirmBranchFile(viewer, CSV, "z.csv", null));
    await refused(runBranchSync({ trigger: "api", user: viewer, mode: "full" }));
    const importer = as([P.BRANCHES_VIEW, P.BRANCHES_IMPORT]);
    const preview = await previewBranchFile(importer, CSV, "z.csv");
    expect(preview).toBeTruthy();
  });

  it("the Branch review needs branches:review", async () => {
    const importer = as([P.BRANCHES_VIEW, P.BRANCHES_IMPORT, P.BRANCHES_MANAGE]);
    await refused(acceptReview(importer, "no-such-item"));
    await refused(ignoreReview(importer, "no-such-item", ""));
    const reviewer = as([P.BRANCHES_VIEW, P.BRANCHES_REVIEW]);
    await passes(ignoreReview(reviewer, "no-such-item", ""));
    await passes(acceptReview(reviewer, "no-such-item"));
  });

  it("Hide from DMS: branches:manage or branches:review, not view or import alone", async () => {
    const b = await prisma.branch.findFirstOrThrow({ where: { hidden: false, active: true, homeUsers: { none: {} } }, orderBy: { code: "desc" } });
    await refused(setBranchHidden(as([P.BRANCHES_VIEW, P.BRANCHES_IMPORT]), b.id, true));
    for (const k of [P.BRANCHES_MANAGE, P.BRANCHES_REVIEW]) {
      const u = as([P.BRANCHES_VIEW, k]);
      await setBranchHidden(u, b.id, true);
      expect((await prisma.branch.findUniqueOrThrow({ where: { id: b.id } })).hidden).toBe(true);
      await setBranchHidden(u, b.id, false);
      expect((await prisma.branch.findUniqueOrThrow({ where: { id: b.id } })).hidden).toBe(false);
    }
  });
});

describe("Settings, System: the PN format is its own tick", () => {
  const raw = { enabled: true, prefix: "GD", branchDigits: "3", yearDigits: "4", system: "9", runningDigits: "5" };
  it("settings:system alone cannot change it; settings:pn_format can", async () => {
    await refused(savePnFormat(as([P.SETTINGS_SYSTEM]), raw));
    await savePnFormat(as([P.SETTINGS_PN_FORMAT]), raw);
    expect((await getSetting("pn.format")).prefix).toBe("GD");
  });
});

describe("MyLoans sync: settings (myloans:manage) and Run now (myloans:sync)", () => {
  it("Run now needs myloans:sync; the settings need myloans:manage", async () => {
    await refused(runSyncNow(as([P.SOURCE_MANAGE])));
    await refused(saveSyncSettings(as([P.MYLOANS_SYNC]), {}));
    // Allowed: the settings get past the check (and fail on the bad number, so nothing is saved).
    await expect(saveSyncSettings(as([P.SOURCE_MANAGE]), { refreshOnOpenMinutes: "x" })).rejects.not.toThrow(DENIED);
    await passes(runSyncNow(as([P.MYLOANS_SYNC])));
  });
});

describe("Email: seeing is not changing", () => {
  it("email:view cannot change anything; email:manage can", async () => {
    const viewer = as([P.EMAIL_VIEW]);
    await refused(setEmailActive(viewer, false));
    await refused(setEmailEvent(viewer, "hold_changed", false));
    await refused(saveEmailTemplate(viewer, "hold_changed", { subject: "x", body: "y" }));
    await refused(resendEmail(viewer, "no-such-email"));
    await refused(sendTestEmail(viewer, "someone@gdfi.ph"));
    const manager = as([P.EMAIL_VIEW, P.EMAIL_MANAGE]);
    const on = (await getSetting("email.events")).hold_changed !== false;
    await setEmailEvent(manager, "hold_changed", !on);
    expect((await getSetting("email.events")).hold_changed !== false).toBe(!on);
    await setEmailEvent(manager, "hold_changed", on);
  });
});

describe("Users: editing a person is not changing their branch access", () => {
  it("users:edit alone saves the name and role, but not the access; access:manage can", async () => {
    const la = await prisma.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" }, include: { accessGrants: true } });
    const base = { name: la.name, email: la.email, roleId: la.roleId, active: la.active };
    const access = JSON.stringify({ all: la.allBranches, grants: la.accessGrants.map((g) => ({ kind: g.kind, divisionId: g.divisionId, areaId: g.areaId, branchId: g.branchId, exclude: g.exclude })), homeBranchId: la.homeBranchId });
    const editor = as([P.USERS_VIEW, P.USERS_EDIT]);
    await expect(saveUser(editor, la.id, { ...base, access })).rejects.toThrow('Ask an Admin to turn on "Change branch access" for your role.');
    await expect(saveUser(editor, la.id, { ...base, branchIds: [] })).rejects.toThrow(/Change branch access/);
    await saveUser(editor, la.id, base); // no access sent: kept as it was
    const after = await prisma.user.findUniqueOrThrow({ where: { id: la.id }, include: { accessGrants: true } });
    expect(after.accessGrants.length).toBe(la.accessGrants.length);
    await saveUser(as([P.USERS_VIEW, P.USERS_EDIT, P.ACCESS_MANAGE]), la.id, { ...base, access });
  });
});
