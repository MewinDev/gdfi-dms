/**
 * Email notifications: outbox, switch, test mode, recipients, batching, retries, templates, reminders.
 * LOCAL database only; a mocked sender (no network).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { notify } from "@/lib/notify";
import { setSetting, getSetting, getHolidaySet } from "@/lib/settings";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import { acceptJob } from "@/lib/services/jobs";
import { requestAdvance } from "@/lib/services/funds";
import {
  buildEmail, drainOutbox, resendEmail, resetEmailTemplate, resetTestSendLimit, saveEmailTemplate, sendTestEmail, setEmailActive, setEmailEvent, setMyEmailNonUrgent,
} from "@/lib/email/outbox";
import { approvalWaiting, runEmailReminders } from "@/lib/email/reminders";
import { setGraphFetch } from "@/lib/email/graph";
import { EMAIL_EVENTS } from "@/lib/email/templates";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, dp: CurrentUser, admin: CurrentUser;
let joy: { id: string; email: string }, fin: { id: string };
const saved = { ...process.env };
const SECRET = "SEKRET-graph-value-987";
type Msg = { to: string; subject: string; html: string; text: string };
const okSender = () => { const calls: Msg[] = []; return { calls, send: async (m: Msg) => { calls.push(m); return { ok: true as const }; } }; };

const emailRows = () => prisma.emailOutbox.findMany({ orderBy: { createdAt: "asc" } });
const note = (event: keyof typeof EMAIL_EVENTS, userIds: string[], extra: Record<string, unknown> = {}) =>
  prisma.$transaction((tx) => notify(tx, { userIds, title: "t", body: "b", link: "/jobs/x", email: { event, vars: { pn: "PN-0001003", transaction: "Notary", who: "Ana" }, ...extra } }));

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  joy = await prisma.user.findUniqueOrThrow({ where: { email: "dp.joy@gdfi.ph" } });
  fin = await prisma.user.findUniqueOrThrow({ where: { email: "test.finance@gdfi.ph" } });
});
beforeEach(async () => {
  process.env = { ...saved, TEST_MODE: "true", EMAIL_TEST_RECIPIENT: "qa.inbox@gdfi.ph", APP_BASE_URL: "http://localhost:3001" };
  await prisma.emailOutbox.deleteMany();
  await setSetting("email.active", false);
  await setSetting("email.events", {});
  await setSetting("email.templates", {});
  await prisma.user.updateMany({ data: { emailNonUrgent: true } });
  resetTestSendLimit();
  setGraphFetch(null);
});
afterEach(() => { process.env = { ...saved }; setGraphFetch(null); });
afterAll(async () => {
  await prisma.emailOutbox.deleteMany();
  await setSetting("email.active", false);
  await setSetting("email.events", {});
  await setSetting("email.templates", {});
  await cleanLoans();
  await prisma.$disconnect();
});

describe("Switch Not active (the default)", () => {
  it("nothing is sent: the email is recorded as Skipped; the test email still works and is audited without the body", async () => {
    expect(await getSetting("email.active")).toBe(false);
    await note("job_sent", [joy.id]);
    const [r] = await emailRows();
    expect(r).toMatchObject({ event: "job_sent", status: "SKIPPED", lastError: "Emails are off", userId: joy.id });
    expect(r.html).toContain("PN-0001003: Notary sent to you");
    const s = okSender();
    expect(await drainOutbox({ send: s.send })).toMatchObject({ sent: 0 });
    expect(s.calls).toHaveLength(0);

    const res = await sendTestEmail(admin, "jamerin@gdfi.ph", { send: s.send });
    expect(res).toEqual({ ok: true, message: "Sent to qa.inbox@gdfi.ph" }); // test mode: the test address
    expect(s.calls[0].subject).toBe("[TEST] Test email from GDFI DMS");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "email_test_sent" }, orderBy: { at: "desc" } });
    expect(JSON.stringify(audit)).not.toContain("<html");
    expect(audit.details).toMatchObject({ to: "qa.inbox@gdfi.ph", ok: true });
  });

  it("test email: at most 3 a minute; only with Manage email notifications", async () => {
    const s = okSender();
    for (let i = 0; i < 3; i++) await sendTestEmail(admin, "jamerin@gdfi.ph", { send: s.send });
    await expect(sendTestEmail(admin, "jamerin@gdfi.ph", { send: s.send })).rejects.toThrow("at most 3 test emails a minute");
    await expect(sendTestEmail(la, "jamerin@gdfi.ph", { send: s.send })).rejects.toThrow(/does not allow managing email/);
    await expect(setEmailActive(la, true)).rejects.toThrow(/does not allow managing email/);
    expect(s.calls).toHaveLength(3);
  });
});

describe("Switch Active", () => {
  beforeEach(async () => { await setEmailActive(admin, true); });

  it("a real action (Send to a processor) queues the processor's email in the same transaction; test mode redirects and prefixes", async () => {
    expect(await prisma.auditLog.count({ where: { action: "email_switch_changed" } })).toBeGreaterThan(0);
    await cleanLoans();
    await openLoanFile(la, { pn: "PN-0001003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "PN-0001003" } });
    const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "EDST" } }, include: { checks: true } });
    const notary = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "NOTARY" } }, include: { checks: true } });
    void txn;
    await saveChecklist(la, { transactionId: notary.id, checkedIds: notary.checks.map((c) => c.id), newOthers: [] });
    const office = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } });
    await assignToDp(la, { transactionId: notary.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: office.id, fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
    const r = await prisma.emailOutbox.findFirstOrThrow({ where: { event: "job_sent" } });
    expect(r).toMatchObject({ status: "QUEUED", userId: dp.id, toAddress: "qa.inbox@gdfi.ph", intendedAddress: "test.dp@gdfi.ph", transactionId: notary.id, urgent: true });
    expect(r.subject).toBe("[TEST] PN-0001003: Notary sent to you");
    expect(r.html).toContain("Would have gone to: Test Document Processor (DP)");
    expect(r.link).toMatch(/^http:\/\/localhost:3001\/jobs\//);
    expect(r.text).toContain(`Process at: ${office.name}.`);
  });

  it("test mode without a test address: Skipped; outside test mode sample users are never emailed, real people are", async () => {
    delete process.env.EMAIL_TEST_RECIPIENT;
    await note("job_sent", [joy.id]);
    expect((await emailRows())[0]).toMatchObject({ status: "SKIPPED", lastError: expect.stringMatching(/no test address/) });
    await prisma.emailOutbox.deleteMany();
    process.env.TEST_MODE = "false";
    await note("job_sent", [joy.id, dp.id]);
    const rows = await emailRows();
    expect(rows.find((r) => r.userId === dp.id)).toMatchObject({ status: "SKIPPED", lastError: "Sample user: never emailed" });
    expect(rows.find((r) => r.userId === joy.id)).toMatchObject({ status: "QUEUED", toAddress: joy.email, subject: "PN-0001003: Notary sent to you" });
  });

  it("per-event switch, per-person non-urgent switch, inactive people", async () => {
    process.env.TEST_MODE = "false";
    await setEmailEvent(admin, "job_accepted", false);
    expect(await prisma.auditLog.count({ where: { action: "email_event_changed" } })).toBeGreaterThan(0);
    await note("job_accepted", [joy.id]);
    expect((await emailRows())[0]).toMatchObject({ status: "SKIPPED", lastError: "This event's emails are off" });
    await setEmailEvent(admin, "job_accepted", true);
    await prisma.emailOutbox.deleteMany();
    await setMyEmailNonUrgent(await asUser("dp.joy@gdfi.ph"), false);
    await note("job_accepted", [joy.id]); // not urgent
    await note("job_sent", [joy.id]); // urgent: always while emails are on
    const rows = await emailRows();
    expect(rows.find((r) => r.event === "job_accepted")).toMatchObject({ status: "SKIPPED", lastError: "They turned off non-urgent emails" });
    expect(rows.find((r) => r.event === "job_sent")).toMatchObject({ status: "QUEUED" });
    await prisma.user.update({ where: { id: joy.id }, data: { active: false } });
    try {
      await prisma.emailOutbox.deleteMany();
      await note("job_sent", [joy.id]);
      expect(await emailRows()).toHaveLength(0);
    } finally {
      await prisma.user.update({ where: { id: joy.id }, data: { active: true } });
    }
  });

  it("amounts only for people who may see amounts (journey:view_amounts)", async () => {
    await prisma.$transaction((tx) => notify(tx, { userIds: [joy.id, fin.id], title: "t", body: "b", email: { event: "advance_released", amountCents: 150000, vars: { number: "CA-2026-0001" } } }));
    const rows = await emailRows();
    expect(rows.find((r) => r.userId === joy.id)!.html).toContain("an amount was released");
    expect(rows.find((r) => r.userId === joy.id)!.html).not.toContain("1,500");
    expect(rows.find((r) => r.userId === fin.id)!.html).toContain("₱1,500.00 was released");
  });

  it("a rolled-back action queues nothing", async () => {
    await expect(prisma.$transaction(async (tx) => {
      await notify(tx, { userIds: [joy.id], title: "t", body: "b", email: { event: "job_sent" } });
      throw new Error("the action failed");
    })).rejects.toThrow("the action failed");
    expect(await emailRows()).toHaveLength(0);
  });
});

describe("The sender worker", () => {
  beforeEach(async () => { process.env.TEST_MODE = "false"; await setEmailActive(admin, true); });

  it("two of the same event for the same person within a minute: one email listing both", async () => {
    await note("job_sent", [joy.id]);
    await prisma.$transaction((tx) => notify(tx, { userIds: [joy.id], title: "t", body: "b", email: { event: "job_sent", vars: { pn: "PN-0001004", transaction: "Entry of PPSR", who: "Ana" } } }));
    const s = okSender();
    expect(await drainOutbox({ send: s.send })).toMatchObject({ sent: 0 }); // waits up to a minute for more
    const later = new Date(Date.now() + 62_000);
    expect(await drainOutbox({ now: later, send: s.send })).toMatchObject({ sent: 2 });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ to: joy.email, subject: "2 updates: Job sent to a processor" });
    expect(s.calls[0].html).toContain("PN-0001003: Notary sent to you");
    expect(s.calls[0].html).toContain("PN-0001004: Entry of PPSR sent to you");
    const rows = await emailRows();
    expect(rows.map((r) => r.status)).toEqual(["SENT", "SENT"]);
    expect(rows[1].batchedIntoId).toBe(rows[0].id);
  });

  it("retries with backoff, honours Retry-After, then Failed with the reason; a throwing sender never escapes", async () => {
    await note("job_sent", [joy.id]);
    const t1 = new Date(Date.now() + 62_000);
    await drainOutbox({ now: t1, send: async () => ({ ok: false, reason: "Microsoft asked to slow down. It will try again.", permanent: false, retryAfterMs: 300_000 }) });
    let [r] = await emailRows();
    expect(r).toMatchObject({ status: "QUEUED", attempts: 1, lastError: "Microsoft asked to slow down. It will try again." });
    expect(r.nextAttemptAt!.getTime()).toBe(t1.getTime() + 300_000);
    const t2 = new Date(t1.getTime() + 300_000);
    await expect(drainOutbox({ now: t2, send: async () => { throw new Error("boom"); } })).resolves.toMatchObject({ retrying: 1 });
    [r] = await emailRows();
    expect(r.attempts).toBe(2);
    await prisma.emailOutbox.update({ where: { id: r.id }, data: { attempts: 4, nextAttemptAt: t2 } });
    await drainOutbox({ now: t2, send: async () => ({ ok: false, reason: "Network problem.", permanent: false }) });
    [r] = await emailRows();
    expect(r).toMatchObject({ status: "FAILED", attempts: 5, lastError: "Network problem." });
    // Resend (audited) puts it back in the queue.
    await resendEmail(admin, r.id);
    expect((await emailRows())[0]).toMatchObject({ status: "QUEUED", attempts: 0, lastError: null });
    expect(await prisma.auditLog.count({ where: { action: "email_resent", entityId: r.id } })).toBe(1);
  });

  it("a permanent failure is Failed at once; turning emails off skips what waits", async () => {
    await note("job_sent", [joy.id]);
    await drainOutbox({ now: new Date(Date.now() + 62_000), send: async () => ({ ok: false, reason: "The sender is not allowed to send mail: check the Mail.Send permission and its admin consent.", permanent: true }) });
    expect((await emailRows())[0]).toMatchObject({ status: "FAILED", attempts: 1 });
    await prisma.emailOutbox.deleteMany();
    await note("job_sent", [joy.id]);
    await setEmailActive(admin, false);
    await drainOutbox({ now: new Date(Date.now() + 62_000), send: okSender().send });
    expect((await emailRows())[0]).toMatchObject({ status: "SKIPPED", lastError: "Emails were turned off before it was sent" });
  });

  it("the real sender (mocked Graph): secrets never reach the outbox, audit or the result", async () => {
    Object.assign(process.env, { GRAPH_CLIENT_ID: "cid-1", GRAPH_CLIENT_SECRET: SECRET, GRAPH_TENANT_ID: "tid-1", GRAPH_SENDER_EMAIL: "no-reply@gdfi.ph" });
    setGraphFetch((async (url: string | URL | Request) => String(url).includes("/token")
      ? new Response(JSON.stringify({ access_token: "TOKEN-xyz", expires_in: 3600 }), { status: 200 })
      : new Response(JSON.stringify({ error: { code: "ErrorAccessDenied", message: `${SECRET} TOKEN-xyz` } }), { status: 403 })) as typeof fetch);
    const r = await sendTestEmail(admin, "jamerin@gdfi.ph");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Mail\.Send permission/);
    const all = JSON.stringify([r, await emailRows(), await prisma.auditLog.findMany({ where: { action: "email_test_sent" } })]);
    for (const s of [SECRET, "TOKEN-xyz", "cid-1", "tid-1"]) expect(all).not.toContain(s);
  });
});

describe("Messages (templates)", () => {
  it("placeholders are checked on save; audited; reset to default; the preview uses the same builder", async () => {
    await expect(saveEmailTemplate(admin, "job_sent", { subject: "{pn} {bogus}", body: "x" })).rejects.toThrow("Unknown placeholder {bogus}");
    await expect(saveEmailTemplate(admin, "job_sent", { subject: "", body: "x" })).rejects.toThrow("Enter the subject.");
    await expect(saveEmailTemplate(la, "job_sent", { subject: "a", body: "b" })).rejects.toThrow(/does not allow/);
    await saveEmailTemplate(admin, "job_sent", { subject: "New job: {pn}", body: "From {who}.\n{reason}" });
    expect((await getSetting("email.templates")).job_sent).toEqual({ subject: "New job: {pn}", body: "From {who}.\n{reason}" });
    expect(await prisma.auditLog.count({ where: { action: "email_template_changed" } })).toBeGreaterThan(0);
    await setEmailActive(admin, true);
    await note("job_sent", [joy.id]);
    expect((await emailRows())[0].subject).toBe("[TEST] New job: PN-0001003");
    await resetEmailTemplate(admin, "job_sent");
    expect((await getSetting("email.templates")).job_sent).toBeUndefined();
    expect(await prisma.auditLog.count({ where: { action: "email_template_reset" } })).toBeGreaterThan(0);
    const b = buildEmail({ subject: "Hi {recipient}", body: "Line" }, { recipient: "Joy" }, "/jobs/1", null);
    expect(b).toMatchObject({ headline: "Hi Joy", subject: "Hi Joy" });
    expect(b.html).toContain('href="http://localhost:3001/jobs/1"');
  });
});

describe("Reminders", () => {
  it("weekends and holidays: no reminders; approval waiting more than a business day: once a day, to the approvers", async () => {
    await setEmailActive(admin, true);
    await cleanLoans();
    await openLoanFile(la, { pn: "PN-0001003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "PN-0001003" } });
    const notary = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "NOTARY" } }, include: { checks: true } });
    await saveChecklist(la, { transactionId: notary.id, checkedIds: notary.checks.map((c) => c.id), newOthers: [] });
    const office = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } });
    await assignToDp(la, { transactionId: notary.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: office.id, fundsNeeded: "YES", fundsKinds: ["TRANSPORT"], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
    const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: notary.id } });
    await acceptJob(dp, job.id, true);
    const adv = await requestAdvance(dp, { lines: [{ transactionId: notary.id, kind: "TRANSPORT", cents: 50000 }] });
    // Asked on Friday Nov 6, 2026 (PHT).
    await prisma.cashAdvance.update({ where: { id: adv.id }, data: { createdAt: new Date("2026-11-06T09:00:00+08:00") } });
    const holidays = await getHolidaySet();
    const saturday = new Date("2026-11-07T10:00:00+08:00");
    expect(await runEmailReminders(saturday)).toMatchObject({ businessDay: false, approvalWaiting: 0 });
    const monday = new Date("2026-11-09T10:00:00+08:00");
    expect(await approvalWaiting(monday, holidays)).toBe(1);
    expect(await approvalWaiting(monday, holidays)).toBe(0); // once a day
    const r = await prisma.emailOutbox.findFirstOrThrow({ where: { event: "approval_waiting" } });
    expect(r.subject).toMatch(/still waiting for approval/);
    const approvers = await prisma.user.findMany({ where: { role: { permissions: { has: "funds:approve" } } }, select: { id: true } });
    expect(approvers.map((a) => a.id)).toContain(r.userId);
  });
});
