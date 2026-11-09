import "server-only";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS, ROLE_CHIPS } from "@/lib/auth/permissions";
import { effectivePermissions } from "@/lib/auth/access";
import { UserError } from "@/lib/services/errors";
import { getSetting, setSetting } from "@/lib/settings";
import { isTestMode } from "@/lib/test-mode";
import { fmtDateTime } from "@/lib/time";
import { peso } from "@/lib/funds/rules";
import { EMAIL_EVENTS, fillLines, fill, isEmailEvent, renderEmail, unknownPlaceholders, type EmailEventKey, type EmailVars, EVENT_DEFAULT_VARS } from "./templates";
import { graphConfig, sendMail, type SendResult } from "./graph";
import { isSimulatedContext } from "./context";

/**
 * The email channel of notifications.
 *  - queueEmails: called by notify() inside the action's transaction (a rolled-back action queues nothing).
 *  - drainOutbox: the sender worker (never inside a user's action), with retries, backoff and one-minute batching.
 * A failed email never fails or slows the user's action.
 */

export interface EmailSpec {
  event: EmailEventKey;
  /** Who gets the email (default: the people who get the notification). */
  to?: string[];
  vars?: EmailVars;
  /** Shown as the amount only to people who may see amounts (journey:view_amounts); others read "an amount". */
  amountCents?: number;
  transactionId?: string | null;
  /** Reminders: one per thing per day (per person). */
  dedupeKey?: string;
}

export const BATCH_WINDOW_MS = 60_000;
export const MAX_ATTEMPTS = 5;
const SKIPPED_KEEP_DAYS = 30;

export const appBaseUrl = () => (process.env.APP_BASE_URL?.trim() || "http://localhost:3001").replace(/\/+$/, "");
const absolute = (link: string | null | undefined) => (link ? (/^https?:\/\//.test(link) ? link : `${appBaseUrl()}${link.startsWith("/") ? "" : "/"}${link}`) : null);
const roleLabel = (r: { key: string; name: string }) => ROLE_CHIPS[r.key]?.label ?? r.name;

async function effectiveTemplate(db: Tx | typeof prisma, event: EmailEventKey) {
  const t = (await getSetting("email.templates", db))[event];
  return t ?? { subject: EMAIL_EVENTS[event].subject, body: EMAIL_EVENTS[event].body };
}

/** Builds one person's email (subject without the [TEST] prefix). Exported for the preview and tests. */
export function buildEmail(
  tpl: { subject: string; body: string },
  vars: EmailVars,
  link: string | null,
  testNote: string | null,
): { headline: string; subject: string; html: string; text: string } {
  const headline = fill(tpl.subject, vars).replace(/\s+/g, " ").trim() || "GDFI DMS update";
  const { html, text } = renderEmail({ headline, lines: fillLines(tpl.body, vars), link: absolute(link), note: testNote });
  return { headline, subject: `${testNote ? "[TEST] " : ""}${headline}`, html, text };
}

export async function queueEmails(
  tx: Tx,
  spec: EmailSpec,
  n: { userIds: string[]; loanId?: string | null; link?: string | null },
  now: Date = new Date(),
) {
  const ids = [...new Set(spec.to ?? n.userIds)];
  if (!ids.length) return;
  const users = await tx.user.findMany({ where: { id: { in: ids }, active: true }, include: { role: true } });
  if (!users.length) return;
  const [active, events, tpl] = await Promise.all([getSetting("email.active", tx), getSetting("email.events", tx), effectiveTemplate(tx, spec.event)]);
  const def = EMAIL_EVENTS[spec.event];
  const testMode = isTestMode();
  const testTo = process.env.EMAIL_TEST_RECIPIENT?.trim() || "";
  const simulated = isSimulatedContext();
  let queued = false;
  for (const u of users) {
    if (!u.email?.includes("@")) continue;
    const key = spec.dedupeKey ? `${spec.dedupeKey}:${u.id}` : null;
    if (key && (await tx.emailOutbox.findUnique({ where: { dedupeKey: key }, select: { id: true } }))) continue;
    const seesAmounts = effectivePermissions(u.role).has(PERMISSIONS.JOURNEY_VIEW_AMOUNTS);
    const vars: EmailVars = {
      when: fmtDateTime(now), recipient: u.name, ...EVENT_DEFAULT_VARS[spec.event], ...spec.vars,
      ...(spec.amountCents !== undefined ? { amount: seesAmounts ? peso(spec.amountCents) : "an amount" } : {}),
    };
    const toName = `${u.name} (${roleLabel(u.role)})`;
    // Where it would go, and why it is not sent (first reason wins).
    let skip: string | null = null;
    let to: string | null = u.email;
    if (!active) skip = "Emails are off";
    else if (events[spec.event] === false) skip = "This event's emails are off";
    else if (!def.urgent && !u.emailNonUrgent) skip = "They turned off non-urgent emails";
    else if (testMode) {
      if (testTo) to = testTo;
      else { to = null; skip = "Test mode: no test address is set (EMAIL_TEST_RECIPIENT)"; }
    } else if (u.isTestUser) skip = "Sample user: never emailed";
    else if (simulated) skip = "Simulator: never emailed outside test mode";
    const note = testMode ? `Would have gone to: ${toName}` : null;
    let mail: ReturnType<typeof buildEmail>;
    try {
      mail = buildEmail(tpl, vars, n.link ?? null, note);
    } catch {
      mail = buildEmail({ subject: EMAIL_EVENTS[spec.event].subject, body: EMAIL_EVENTS[spec.event].body }, vars, n.link ?? null, note);
    }
    await tx.emailOutbox.create({
      data: {
        event: spec.event, userId: u.id, toName, intendedAddress: u.email, toAddress: to,
        subject: mail.subject, html: mail.html, text: mail.text, headline: mail.headline, link: absolute(n.link), urgent: def.urgent,
        status: skip ? "SKIPPED" : "QUEUED", lastError: skip, nextAttemptAt: skip ? null : new Date(now.getTime() + BATCH_WINDOW_MS),
        dedupeKey: key, loanId: n.loanId ?? null, transactionId: spec.transactionId ?? null, simulated, createdAt: now,
      },
    });
    if (!skip) queued = true;
  }
  if (queued) scheduleDrain(BATCH_WINDOW_MS + 1_000);
}

// ---------------------------------------------------------------------------
// The sender worker
// ---------------------------------------------------------------------------

type Row = Awaited<ReturnType<typeof prisma.emailOutbox.findMany>>[number];
type Sender = (m: { to: string; subject: string; html: string; text: string }) => Promise<SendResult>;

/** Several of the same event for the same person within a minute: one email listing them. */
export function combine(rows: Row[]) {
  if (rows.length === 1) return { subject: rows[0].subject, html: rows[0].html, text: rows[0].text };
  const first = rows[0];
  const test = first.subject.startsWith("[TEST] ");
  const label = EMAIL_EVENTS[first.event as EmailEventKey]?.label ?? "Updates";
  const headline = `${rows.length} updates: ${label}`;
  const { html, text } = renderEmail({
    headline, lines: rows.map((r) => r.headline), link: `${appBaseUrl()}/notifications`,
    note: test ? `Would have gone to: ${first.toName}` : null,
  });
  return { subject: `${test ? "[TEST] " : ""}${headline}`, html, text };
}

export const backoffMs = (attempts: number) => 60_000 * 2 ** Math.max(0, attempts - 1);

export async function drainOutbox(opts: { now?: Date; send?: Sender } = {}): Promise<{ sent: number; failed: number; retrying: number }> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? ((m) => sendMail(m, now.getTime()));
  await prisma.emailOutbox.deleteMany({ where: { status: "SKIPPED", createdAt: { lt: new Date(now.getTime() - SKIPPED_KEEP_DAYS * 86_400_000) } } });
  const out = { sent: 0, failed: 0, retrying: 0 };
  // Turned off while some waited: they are not sent.
  if (!(await getSetting("email.active"))) {
    await prisma.emailOutbox.updateMany({ where: { status: "QUEUED", event: { not: "test" } }, data: { status: "SKIPPED", lastError: "Emails were turned off before it was sent", nextAttemptAt: null } });
    return out;
  }
  const due = await prisma.emailOutbox.findMany({ where: { status: "QUEUED", nextAttemptAt: { lte: now } }, orderBy: { createdAt: "asc" }, take: 100 });
  const done = new Set<string>();
  for (const r of due) {
    if (done.has(r.id)) continue;
    const group = await prisma.emailOutbox.findMany({
      where: { status: "QUEUED", event: r.event, userId: r.userId, toAddress: r.toAddress, createdAt: { gte: r.createdAt, lte: new Date(r.createdAt.getTime() + BATCH_WINDOW_MS) } },
      orderBy: { createdAt: "asc" },
    });
    group.forEach((g) => done.add(g.id));
    // Claim the rows (another worker skips them).
    const claim = new Date(now.getTime() + 10 * 60_000 + Math.floor(Math.random() * 1000));
    await prisma.emailOutbox.updateMany({ where: { id: { in: group.map((g) => g.id) }, status: "QUEUED" }, data: { nextAttemptAt: claim } });
    const mine = await prisma.emailOutbox.findMany({ where: { id: { in: group.map((g) => g.id) }, status: "QUEUED", nextAttemptAt: claim }, orderBy: { createdAt: "asc" } });
    if (!mine.length || !mine[0].toAddress) continue;
    const msg = combine(mine);
    let res: SendResult;
    try {
      res = await send({ to: mine[0].toAddress, ...msg });
    } catch {
      res = { ok: false, reason: "Network problem.", permanent: false };
    }
    const attempts = Math.max(...mine.map((m) => m.attempts)) + 1;
    const [carrier, ...rest] = mine;
    if (res.ok) {
      await prisma.emailOutbox.update({ where: { id: carrier.id }, data: { status: "SENT", sentAt: now, attempts, lastError: null, nextAttemptAt: null } });
      if (rest.length) await prisma.emailOutbox.updateMany({ where: { id: { in: rest.map((x) => x.id) } }, data: { status: "SENT", sentAt: now, attempts, lastError: null, nextAttemptAt: null, batchedIntoId: carrier.id } });
      out.sent += mine.length;
    } else if (res.permanent || attempts >= MAX_ATTEMPTS) {
      await prisma.emailOutbox.updateMany({ where: { id: { in: mine.map((x) => x.id) } }, data: { status: "FAILED", attempts, lastError: res.reason, nextAttemptAt: null } });
      out.failed += mine.length;
    } else {
      const wait = Math.max(res.retryAfterMs ?? 0, backoffMs(attempts));
      await prisma.emailOutbox.updateMany({ where: { id: { in: mine.map((x) => x.id) } }, data: { attempts, lastError: res.reason, nextAttemptAt: new Date(now.getTime() + wait) } });
      out.retrying += mine.length;
    }
  }
  return out;
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Runs the worker a little later in this server process (after the action's transaction is committed). */
export function scheduleDrain(ms: number) {
  if (process.env.VITEST || process.env.EMAIL_AUTO_DRAIN === "false" || timer) return;
  timer = setTimeout(async () => {
    timer = null;
    try {
      await drainOutbox();
      const next = await prisma.emailOutbox.findFirst({ where: { status: "QUEUED" }, orderBy: { nextAttemptAt: "asc" }, select: { nextAttemptAt: true } });
      if (next?.nextAttemptAt) scheduleDrain(Math.min(Math.max(next.nextAttemptAt.getTime() - Date.now(), 1_000), 3_600_000));
    } catch {
      // The worker never throws into the app; the cron endpoint also drains.
    }
  }, ms);
  (timer as { unref?: () => void }).unref?.();
}

// ---------------------------------------------------------------------------
// Settings: switch, events, messages, test email, resend
// ---------------------------------------------------------------------------

function needManage(u: CurrentUser) {
  if (!can(u, PERMISSIONS.EMAIL_MANAGE)) throw new UserError("Your role does not allow managing email notifications.");
}
const actor = (u: CurrentUser) => ({ id: u.id, label: u.name });

export async function setEmailActive(u: CurrentUser, on: boolean) {
  needManage(u);
  await prisma.$transaction(async (tx) => {
    const before = await getSetting("email.active", tx);
    if (before === on) return;
    await setSetting("email.active", on, tx);
    await writeAudit(tx, { actor: actor(u), mode: "MANUAL", action: "email_switch_changed", entityType: "Setting", entityId: "email.active", summary: `${u.name} turned emails ${on ? "on (Active)" : "off (Not active)"}`, before: { active: before }, after: { active: on } });
  });
}

export async function setEmailEvent(u: CurrentUser, event: string, on: boolean) {
  needManage(u);
  if (!isEmailEvent(event)) throw new UserError("Pick an email event.");
  await prisma.$transaction(async (tx) => {
    const map = { ...(await getSetting("email.events", tx)) };
    const before = map[event] !== false;
    if (before === on) return;
    if (on) delete map[event]; else map[event] = false;
    await setSetting("email.events", map, tx);
    await writeAudit(tx, { actor: actor(u), mode: "MANUAL", action: "email_event_changed", entityType: "Setting", entityId: `email.events.${event}`, summary: `${u.name} turned ${on ? "on" : "off"} emails for "${EMAIL_EVENTS[event].label}"`, before: { on: before }, after: { on } });
  });
}

export const templateSchema = z.object({
  subject: z.string().trim().min(1, "Enter the subject.").max(150, "Keep the subject under 150 characters."),
  body: z.string().trim().min(1, "Enter the message.").max(2000, "Keep the message under 2,000 characters."),
});

export async function saveEmailTemplate(u: CurrentUser, event: string, raw: unknown) {
  needManage(u);
  if (!isEmailEvent(event)) throw new UserError("Pick an email event.");
  const p = templateSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  for (const f of ["subject", "body"] as const) {
    const bad = unknownPlaceholders(p.data[f]);
    if (bad.length) throw new UserError(`Unknown placeholder ${bad.map((b) => `{${b}}`).join(", ")}. Use one from the list.`, f);
  }
  await prisma.$transaction(async (tx) => {
    const map = { ...(await getSetting("email.templates", tx)) };
    const before = map[event] ?? { subject: EMAIL_EVENTS[event].subject, body: EMAIL_EVENTS[event].body };
    const isDefault = p.data.subject === EMAIL_EVENTS[event].subject && p.data.body === EMAIL_EVENTS[event].body;
    if (isDefault) delete map[event]; else map[event] = p.data;
    await setSetting("email.templates", map, tx);
    await writeAudit(tx, { actor: actor(u), mode: "MANUAL", action: "email_template_changed", entityType: "Setting", entityId: `email.templates.${event}`, summary: `${u.name} changed the email message for "${EMAIL_EVENTS[event].label}"`, before, after: p.data });
  });
}

export async function resetEmailTemplate(u: CurrentUser, event: string) {
  needManage(u);
  if (!isEmailEvent(event)) throw new UserError("Pick an email event.");
  await prisma.$transaction(async (tx) => {
    const map = { ...(await getSetting("email.templates", tx)) };
    if (!map[event]) return;
    const before = map[event];
    delete map[event];
    await setSetting("email.templates", map, tx);
    await writeAudit(tx, { actor: actor(u), mode: "MANUAL", action: "email_template_reset", entityType: "Setting", entityId: `email.templates.${event}`, summary: `${u.name} reset the email message for "${EMAIL_EVENTS[event].label}" to the default`, before });
  });
}

export async function resendEmail(u: CurrentUser, id: string) {
  needManage(u);
  await prisma.$transaction(async (tx) => {
    const r = await tx.emailOutbox.findUnique({ where: { id } });
    if (!r || r.status !== "FAILED") throw new UserError("Only a failed email can be sent again.");
    if (!r.toAddress) throw new UserError("This email has no address to send to.");
    await tx.emailOutbox.update({ where: { id }, data: { status: "QUEUED", attempts: 0, lastError: null, nextAttemptAt: new Date() } });
    await writeAudit(tx, { actor: actor(u), mode: "MANUAL", action: "email_resent", entityType: "EmailOutbox", entityId: id, loanId: r.loanId, summary: `${u.name} sent a failed email again (${EMAIL_EVENTS[r.event as EmailEventKey]?.label ?? r.event}, to ${r.toName})` });
  });
  scheduleDrain(1_000);
}

export type OutboxFilter = { status?: string; from?: string; to?: string; before?: string };
/** Recent emails for the Email card and its CSV (newest first). Old Skipped rows are cleared after 30 days. */
export async function listOutbox(f: OutboxFilter = {}, take = 50) {
  await prisma.emailOutbox.deleteMany({ where: { status: "SKIPPED", createdAt: { lt: new Date(Date.now() - SKIPPED_KEEP_DAYS * 86_400_000) } } });
  const status = ["QUEUED", "SENT", "FAILED", "SKIPPED"].includes(f.status ?? "") ? (f.status as "QUEUED" | "SENT" | "FAILED" | "SKIPPED") : undefined;
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  return prisma.emailOutbox.findMany({
    where: {
      ...(status ? { status } : {}),
      createdAt: {
        ...(f.from && ymd.test(f.from) ? { gte: new Date(`${f.from}T00:00:00+08:00`) } : {}),
        ...(f.to && ymd.test(f.to) ? { lte: new Date(`${f.to}T23:59:59.999+08:00`) } : {}),
        // Paging: the next 50 older than the last one shown.
        ...(f.before && !Number.isNaN(Date.parse(f.before)) ? { lt: new Date(f.before) } : {}),
      },
    },
    orderBy: { createdAt: "desc" }, take,
  });
}

export async function setMyEmailNonUrgent(u: CurrentUser, on: boolean) {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { emailNonUrgent: on } });
    await writeAudit(tx, { actor: actor(u), mode: "MANUAL", action: "email_preference_changed", entityType: "User", entityId: u.id, summary: `${u.name} turned ${on ? "on" : "off"} emails for non-urgent updates`, after: { emailNonUrgent: on } });
  });
}

// Test email: one at a time, at most 3 a minute per Admin. Works while emails are Not active.
const testSends = new Map<string, number[]>();
export const TEST_LIMIT = 3;
/** Tests only. */
export const resetTestSendLimit = () => testSends.clear();

const addressSchema = z.string().trim().toLowerCase().email("Enter an email address, for example name@gdfi.ph.").max(200);

export async function sendTestEmail(u: CurrentUser, rawAddress: string, opts: { now?: Date; send?: Sender } = {}): Promise<{ ok: boolean; message: string }> {
  needManage(u);
  const now = opts.now ?? new Date();
  const p = addressSchema.safeParse(rawAddress);
  if (!p.success) throw new UserError(p.error.issues[0].message, "to");
  const recent = (testSends.get(u.id) ?? []).filter((t) => now.getTime() - t < 60_000);
  if (recent.length >= TEST_LIMIT) throw new UserError("Wait a minute: at most 3 test emails a minute.", "to");
  testSends.set(u.id, [...recent, now.getTime()]);
  return sendTestCore({ id: u.id, label: u.name }, p.data, { ...opts, now });
}

/** npm run email:test -- name@gdfi.ph (server console; same rules, recorded as "System"). */
export async function sendTestFromConsole(rawAddress: string) {
  const p = addressSchema.safeParse(rawAddress);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  return sendTestCore({ id: null, label: "System (npm run email:test)" }, p.data, {});
}

async function sendTestCore(who: { id: string | null; label: string }, typed: string, opts: { now?: Date; send?: Sender }): Promise<{ ok: boolean; message: string }> {
  const now = opts.now ?? new Date();
  const u = { id: who.id, name: who.label };
  const testTo = process.env.EMAIL_TEST_RECIPIENT?.trim();
  const to = isTestMode() && testTo ? testTo : typed;
  const note = to !== typed ? `Test mode: sent to the test address. Would have gone to: ${typed}` : null;
  const headline = "Test email from GDFI DMS";
  const { html, text } = renderEmail({
    headline, note,
    lines: ["This is a test. If you can read it, GDFI DMS can send emails.", `Sent by ${u.name} on ${fmtDateTime(now)}.`],
    link: `${appBaseUrl()}/admin/settings?open=email`,
  });
  const subject = `${note ? "[TEST] " : ""}${headline}`;
  const send = opts.send ?? ((m) => sendMail(m, now.getTime()));
  let res: SendResult;
  try { res = await send({ to, subject, html, text }); } catch { res = { ok: false, reason: "Network problem.", permanent: false }; }
  await prisma.$transaction(async (tx) => {
    await tx.emailOutbox.create({
      data: {
        event: "test", userId: u.id, toName: `${u.name} (test email)`, intendedAddress: typed, toAddress: to, subject, html, text, headline, link: `${appBaseUrl()}/admin/settings?open=email`,
        status: res.ok ? "SENT" : "FAILED", attempts: 1, lastError: res.ok ? null : res.reason, sentAt: res.ok ? now : null, createdAt: now,
      },
    });
    // The audit row never holds the message body.
    await writeAudit(tx, { actor: who, mode: who.id ? "MANUAL" : "AUTOMATIC", action: "email_test_sent", entityType: "EmailOutbox", summary: res.ok ? `${u.name} sent a test email to ${to}` : `${u.name} tried a test email to ${to}: ${res.reason}`, details: { to, ok: res.ok, reason: res.ok ? null : res.reason } });
  });
  return res.ok ? { ok: true, message: `Sent to ${to}` } : { ok: false, message: res.reason };
}

/** For the Email card. */
export function senderLine() {
  const c = graphConfig();
  return c.configured ? `Sends from ${c.sender} through Microsoft` : "Not set up";
}
