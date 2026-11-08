"use client";

import { startTransition, useActionState, useId, useMemo, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { GuardedSheet, SheetCancel } from "@/components/ui/guarded-sheet";
import { announcing } from "@/components/ui/live-toast";
import { SAVED_EVENT } from "./settings-modal";
import {
  emailEventAction, emailSwitchAction, emailTemplateAction, myEmailPreferenceAction, resendEmailAction, testEmailAction,
} from "@/app/actions/email";
import { PLACEHOLDERS, SAMPLE_VARS, fill, fillLines, renderEmail, unknownPlaceholders } from "@/lib/email/templates";

const switchAnnounced = announcing(emailSwitchAction);
const eventAnnounced = announcing(emailEventAction);
const resendAnnounced = announcing(resendEmailAction);
const prefAnnounced = announcing(myEmailPreferenceAction);

/** The master switch: Active / Not active. Turning on asks first. */
export function EmailMasterSwitch({ active }: { active: boolean }) {
  const [state, action, pending] = useActionState(switchAnnounced, null);
  const [ask, setAsk] = useState(false);
  const submit = (value: "on" | "off") => {
    const fd = new FormData();
    fd.set("value", value);
    startTransition(() => action(fd));
  };
  return (
    <div className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center ${active ? "border-ok-fg/30 bg-ok-bg" : "border-line bg-white"}`} data-email-switch>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[17px] font-bold text-navy">
          Emails
          <span className={`chip ${active ? "c-ok" : "c-mute"}`} data-email-state>{active ? "Active" : "Not active"}</span>
        </p>
        <p className="text-[13px] text-ink-2">{active ? "People get emails for the events below." : "Nothing is sent. Emails that would go out are listed below as Skipped."}</p>
        {state && !state.ok && <FormMessage state={state} />}
      </div>
      <button
        type="button" role="switch" aria-checked={active} aria-label="Emails Active" disabled={pending}
        onClick={() => (active ? submit("off") : setAsk(true))}
        className={`relative inline-flex h-11 w-[92px] shrink-0 items-center rounded-full border-2 transition-colors ${active ? "border-navy bg-navy" : "border-line-input bg-fill-strong"}`}
      >
        <span className={`absolute top-1 h-8 w-8 rounded-full shadow transition-all ${active ? "left-[50px] bg-gold" : "left-1 bg-white"}`} />
        <span className={`w-full px-3 text-xs font-bold ${active ? "text-left text-white" : "text-right text-ink-2"}`}>{active ? "ON" : "OFF"}</span>
      </button>
      <ConfirmDialog
        open={ask} title="Turn on emails?" body="People will start getting emails for the events below."
        confirmLabel="Turn on emails" onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); submit("on"); }}
      />
    </div>
  );
}

/** Send a test email: one at a time, works while emails are Not active. */
export function TestEmailButton({ defaultTo, testMode, testRecipient }: { defaultTo: string; testMode: boolean; testRecipient: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(testEmailAction, null);
  const [to, setTo] = useState(defaultTo);
  const uid = useId();
  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>Send a test email</button>
      <GuardedSheet open={open} onClose={() => setOpen(false)} title="Send a test email">
        <form action={action} className="flex flex-col gap-3">
          <p className="rounded-xl bg-fill px-3 py-2 text-[13px]">One email to check that sending works. It is sent even while emails are Not active.</p>
          {testMode && (
            <p className="text-[13px] text-act-fg">{testRecipient ? "Test mode: it goes to the test address (EMAIL_TEST_RECIPIENT)." : "Test mode: no test address is set, so it goes to the address below."}</p>
          )}
          <div>
            <label htmlFor={`${uid}-to`} className="label">Send to</label>
            <input id={`${uid}-to`} name="to" type="email" required className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!(state && !state.ok && state.field === "to")} />
          </div>
          {state && (
            <p role="status" className={`rounded-xl px-3 py-2 text-[14px] font-semibold ${state.ok ? "bg-ok-bg text-ok-fg" : "bg-bad-bg text-bad-fg"}`} data-test-result>
              {state.ok ? state.message : state.error}
            </p>
          )}
          <div className="flex justify-end gap-2"><SheetCancel>Close</SheetCancel><SubmitButton>Send</SubmitButton></div>
        </form>
      </GuardedSheet>
    </>
  );
}

export interface EventRowData { key: string; label: string; to: string; urgent: boolean; on: boolean; edited: boolean; editHref: string }

/** One event: who gets it, urgent or not, its switch and Edit message. */
export function EmailEventRow({ e }: { e: EventRowData }) {
  const [state, action, pending] = useActionState(eventAnnounced, null);
  return (
    <li className="flex flex-col gap-2 border-b border-line-soft py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4" data-email-event={e.key}>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-[15px] font-semibold text-ink">
          {e.label}
          {e.urgent && <span className="chip c-act h-6 text-xs">Urgent</span>}
          {e.edited && <span className="chip c-mute h-6 text-xs">Edited</span>}
        </p>
        <p className="text-[13px] text-ink-2">To: {e.to}</p>
        {state && !state.ok && <FormMessage state={state} />}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a href={e.editHref} className="btn-ghost btn-sm">Edit message</a>
        <form action={action}>
          <input type="hidden" name="event" value={e.key} />
          <input type="hidden" name="value" value={e.on ? "off" : "on"} />
          <button type="submit" role="switch" aria-checked={e.on} aria-label={`Emails for ${e.label}`} disabled={pending}
            className={`relative inline-flex h-7 w-12 items-center rounded-full ${e.on ? "bg-navy" : "bg-fill-strong"}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full shadow ${e.on ? "left-6 bg-gold" : "left-1 bg-white"}`} />
          </button>
        </form>
      </div>
    </li>
  );
}

/** Edit message: subject and body with placeholders, live preview, Reset to default. */
export function EmailTemplateForm({ event, label, subject, body, defaults, formId }: {
  event: string; label: string; subject: string; body: string; defaults: { subject: string; body: string }; formId: string;
}) {
  const [s, setS] = useState(subject);
  const [b, setB] = useState(body);
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof emailTemplateAction>>, fd: FormData) => {
    const r = await emailTemplateAction(prev, fd);
    if (r?.ok) {
      window.dispatchEvent(new Event(SAVED_EVENT));
      if (fd.get("$reset")) { setS(defaults.subject); setB(defaults.body); }
    }
    return r;
  }, null);
  const uid = useId();
  const bad = useMemo(() => [...new Set([...unknownPlaceholders(s), ...unknownPlaceholders(b)])], [s, b]);
  const preview = useMemo(() => {
    const headline = fill(s, SAMPLE_VARS).replace(/\s+/g, " ").trim() || "GDFI DMS update";
    return { headline, html: renderEmail({ headline, lines: fillLines(b, SAMPLE_VARS), link: "https://dms.gdfi.ph/" }).html };
  }, [s, b]);
  // A server message goes away once the person edits again (the live check above stays).
  const [editedAfter, setEditedAfter] = useState<number | undefined>(undefined);
  const current = state && state.at !== editedAfter ? state : null;
  const err = (f: string) => (current && !current.ok && current.field === f ? current.error : null);
  const edit = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { set(e.target.value); setEditedAfter(state?.at); };
  return (
    <form id={formId} data-track-dirty className="grid gap-4 lg:grid-cols-2"
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter); startTransition(() => action(fd)); }}>
      <input type="hidden" name="event" value={event} />
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-[13px] text-ink-2">{label}. Plain words, one short headline and three or four lines.</p>
        <div>
          <label htmlFor={`${uid}-s`} className="label">Subject</label>
          <input id={`${uid}-s`} name="subject" className="input" value={s} onChange={edit(setS)} maxLength={150} aria-invalid={!!err("subject")} />
          {err("subject") && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{err("subject")}</p>}
        </div>
        <div>
          <label htmlFor={`${uid}-b`} className="label">Message (one line each)</label>
          <textarea id={`${uid}-b`} name="body" rows={6} className="input" value={b} onChange={edit(setB)} maxLength={2000} aria-invalid={!!err("body")} />
          {err("body") && <p className="mt-1 text-[13px] font-semibold text-bad-fg">{err("body")}</p>}
        </div>
        {bad.length > 0 && <p className="text-[13px] font-semibold text-bad-fg" role="status">Unknown placeholder {bad.map((x) => `{${x}}`).join(", ")}. Use one from the list.</p>}
        {current && !current.ok && !["subject", "body"].includes(current.field ?? "") && <FormMessage state={current} />}
        {current?.ok && <p role="status" className="text-[13px] font-semibold text-ok-fg">{current.message}</p>}
        <details className="rounded-xl border border-line-soft p-3" open>
          <summary className="cursor-pointer text-[13px] font-semibold text-navy">Placeholders</summary>
          <ul className="mt-2 grid gap-1 text-[13px]">
            {Object.entries(PLACEHOLDERS).map(([k, v]) => (
              <li key={k}><code className="mono rounded bg-fill px-1">{`{${k}}`}</code> {v}</li>
            ))}
          </ul>
        </details>
        <div><button type="submit" name="$reset" value="1" className="btn-ghost btn-sm">Reset to default</button></div>
      </div>
      <div className="flex min-w-0 flex-col gap-2" data-email-preview>
        <p className="label">Preview (sample values)</p>
        <p className="truncate text-[13px]"><span className="text-ink-2">Subject:</span> <strong>{preview.headline}</strong></p>
        <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[420px] w-full rounded-xl border border-line bg-white" />
      </div>
    </form>
  );
}

export interface OutboxRow {
  id: string; when: string; event: string; to: string; address: string | null; status: "QUEUED" | "SENT" | "FAILED" | "SKIPPED"; reason: string | null; subject: string; html: string; text: string;
}
const STATUS_CHIP = { SENT: ["Sent", "c-ok"], FAILED: ["Failed", "c-bad"], SKIPPED: ["Skipped", "c-mute"], QUEUED: ["Queued", "c-wait"] } as const;

/** Recent emails: a row opens the message; Failed ones can be sent again. */
export function RecentEmails({ rows, canResend }: { rows: OutboxRow[]; canResend: boolean }) {
  const [open, setOpen] = useState<OutboxRow | null>(null);
  const [state, action] = useActionState(resendAnnounced, null);
  if (!rows.length) return <p className="rounded-xl bg-fill px-3 py-4 text-center text-sm text-ink-2" data-recent-empty>No emails yet. They appear here when an event happens or a test email is sent.</p>;
  return (
    <>
      <div className="max-w-full overflow-x-auto rounded-xl border border-line" data-recent-emails>
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <caption className="sr-only">Recent emails</caption>
          <thead className="bg-fill text-xs uppercase tracking-wide text-ink-2">
            <tr><th scope="col" className="px-3 py-2">Time (PHT)</th><th scope="col" className="px-3 py-2">Event</th><th scope="col" className="px-3 py-2">To</th><th scope="col" className="px-3 py-2">Status</th><th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line-soft align-top">
                <td className="whitespace-nowrap px-3 py-2">{r.when}</td>
                <td className="px-3 py-2">
                  <button type="button" className="link text-left" onClick={() => setOpen(r)}>{r.event}</button>
                  <span className="block text-ink-2">{r.subject}</span>
                </td>
                <td className="px-3 py-2">{r.to}{r.address && <span className="block text-ink-2">{r.address}</span>}</td>
                <td className="px-3 py-2">
                  <span className={`chip h-6 text-xs ${STATUS_CHIP[r.status][1]}`}>{STATUS_CHIP[r.status][0]}</span>
                  {r.reason && <span className={`mt-1 block ${r.status === "FAILED" ? "font-semibold text-bad-fg" : "text-ink-2"}`}>{r.reason}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {canResend && r.status === "FAILED" && (
                    <form action={action}><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn-ghost btn-sm">Resend</SubmitButton></form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state && !state.ok && <FormMessage state={state} />}
      <GuardedSheet open={!!open} onClose={() => setOpen(null)} title="Email">
        {open && (
          <div className="flex flex-col gap-2" data-email-message>
            <p className="text-[13px]"><span className="text-ink-2">To:</span> {open.to}{open.address ? ` · ${open.address}` : ""}</p>
            <p className="text-[13px]"><span className="text-ink-2">Subject:</span> <strong>{open.subject}</strong></p>
            <iframe title="Email message" sandbox="" srcDoc={open.html} className="h-[460px] w-full rounded-xl border border-line bg-white" />
            <details><summary className="cursor-pointer text-[13px] text-navy">Plain-text version</summary><pre className="mt-2 whitespace-pre-wrap text-[12px]">{open.text}</pre></details>
            <div className="flex justify-end"><SheetCancel>Close</SheetCancel></div>
          </div>
        )}
      </GuardedSheet>
    </>
  );
}

/** Updates page: the person's own switch for non-urgent emails. */
export function MyEmailPreference({ on, active }: { on: boolean; active: boolean }) {
  const [state, action, pending] = useActionState(prefAnnounced, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3 rounded-xl border border-line-soft bg-white px-4 py-3" data-email-pref>
      <input type="hidden" name="value" value={on ? "off" : "on"} />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">Email me for non-urgent updates</p>
        <p className="text-[13px] text-ink-2">Urgent ones (a job sent to you, a return, an approval needed, a release, a problem on your job) always come{active ? "" : " once emails are turned on"}.</p>
        {state && !state.ok && <FormMessage state={state} />}
      </div>
      <button type="submit" role="switch" aria-checked={on} aria-label="Email me for non-urgent updates" disabled={pending}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full ${on ? "bg-navy" : "bg-fill-strong"}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full shadow ${on ? "left-6 bg-gold" : "left-1 bg-white"}`} />
      </button>
    </form>
  );
}
