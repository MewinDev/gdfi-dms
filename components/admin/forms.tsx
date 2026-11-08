"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SAVED_EVENT } from "./settings-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { mockOverrideAction, saveFundsSettingsAction, saveSettingsAction, saveUserAction, toggleAction } from "@/app/actions/admin";
import { FormMessage, SubmitButton } from "@/components/form-status";

/**
 * Submits a form to its action without React's automatic form reset, so a refused save keeps what
 * the person typed (the error shows beside the field and they fix just that).
 */
function submitKeepingValues(e: React.FormEvent<HTMLFormElement>, action: (fd: FormData) => void) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
  startTransition(() => action(fd));
}

export interface FieldDef {
  name: string;
  label: string;
  type: "text" | "number" | "checkbox" | "select" | "date" | "evidence";
  options?: [string, string][];
  value?: string | number | boolean | null;
  width?: "sm" | "md" | "lg";
  readOnly?: boolean;
  help?: string;
  /** Checkbox only: enabled only while this other checkbox is on (switched off with `offNote` when it is turned off). */
  dependsOn?: string;
  offNote?: string;
}

/** One editable settings row (or the "Add" row when id is null). */
export function SettingsRowForm({ kind, id, fields, submitLabel }: { kind: string; id: string | null; fields: FieldDef[]; submitLabel?: string }) {
  const [state, action] = useActionState(saveSettingsAction, null);
  const uid = `${kind}-${id ?? "new"}`;
  return (
    <form action={action} className="rounded-lg border border-line bg-white p-3">
      <input type="hidden" name="kind" value={kind} />
      {id && <input type="hidden" name="id" value={id} />}
      <div className="flex flex-wrap items-end gap-3">
        {fields.map((f) => {
          const fid = `${uid}-${f.name}`;
          const w = f.width === "lg" ? "min-w-64 flex-1" : f.width === "sm" ? "w-24" : "w-44";
          if (f.type === "checkbox") {
            return (
              <label key={f.name} htmlFor={fid} className="flex items-center gap-2 pb-2 text-sm">
                <input type="hidden" name={`$has_${f.name}`} value="1" />
                <input id={fid} type="checkbox" name={f.name} defaultChecked={!!f.value} className="h-4 w-4 accent-[var(--navy)]" />
                {f.label}
              </label>
            );
          }
          return (
            <div key={f.name} className={w}>
              <label htmlFor={fid} className="label">{f.label}</label>
              {f.type === "select" ? (
                <select id={fid} name={f.name} defaultValue={String(f.value ?? "")} className="input" aria-invalid={state?.field === f.name}>
                  {f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : (
                <input
                  id={fid}
                  name={f.name}
                  type={f.type === "number" ? "text" : f.type}
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  defaultValue={f.value === null || f.value === undefined ? "" : String(f.value)}
                  readOnly={f.readOnly}
                  className={`input ${f.readOnly ? "bg-cream" : ""}`}
                  aria-invalid={state?.field === f.name}
                />
              )}
            </div>
          );
        })}
        <SubmitButton className={id ? "btn-secondary" : "btn-primary"}>{submitLabel ?? (id ? "Save" : "Add")}</SubmitButton>
      </div>
      {state && <div className="mt-2"><FormMessage state={state} /></div>}
    </form>
  );
}

/** Cash-advance switches (top of the Cash-advance rules pop-up). */
export function FundsSettingsForm({ carryOverLimitDays, liquidationDueDays, blockLtoUntilFunded }: { carryOverLimitDays: number; liquidationDueDays: number; blockLtoUntilFunded: boolean }) {
  const [state, action] = useActionState(saveFundsSettingsAction, null);
  return (
    <form onSubmit={(e) => submitKeepingValues(e, action)} className="mb-4 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_auto] lg:items-end">
      <div>
        <label htmlFor="fs-carry" className="label">Carry-over limit (business days)</label>
        <input id="fs-carry" name="carryOverLimitDays" type="number" min={0} max={60} required defaultValue={carryOverLimitDays} className="input" />
      </div>
      <div>
        <label htmlFor="fs-liq" className="label">Liquidation due (business days)</label>
        <input id="fs-liq" name="liquidationDueDays" type="number" min={1} max={90} required defaultValue={liquidationDueDays} className="input" />
      </div>
      <label className="inline-flex min-h-11 items-center gap-2 text-[15px]">
        <input type="checkbox" name="blockLtoUntilFunded" defaultChecked={blockLtoUntilFunded} className="h-5 w-5 accent-[var(--navy)]" />
        Block &ldquo;At the LTO&rdquo; until funded
      </label>
      <SubmitButton className="btn-secondary">Save switches</SubmitButton>
      {state && <div className="sm:col-span-2 lg:col-span-4"><FormMessage state={state} /></div>}
    </form>
  );
}

export function ToggleForm({ settingKey, label, description, on }: { settingKey: string; label: string; description: string; on: boolean }) {
  const [state, action] = useActionState(toggleAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4">
      <input type="hidden" name="key" value={settingKey} />
      <input type="hidden" name="value" value={on ? "off" : "on"} />
      <div>
        <p className="font-semibold">{label} <span className={`chip ml-1 ${on ? "bg-warn-bg text-warn-fg" : "bg-chip-sys"}`}>{on ? "On" : "Off"}</span></p>
        <p className="text-xs text-ink-2">{description}</p>
        {state && !state.ok && <FormMessage state={state} />}
      </div>
      <SubmitButton className={on ? "btn-secondary" : "btn-primary"}>{on ? "Turn off" : "Turn on"}</SubmitButton>
    </form>
  );
}

export function MockOverrideForm({ current }: { current: [string, { totalReleasedAmount?: number | string | null }][] }) {
  const [state, action] = useActionState(mockOverrideAction, null);
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="font-semibold">Simulate a source change (mock MyLoans only)</p>
      <p className="text-xs text-ink-2">Changes the amount MyLoans returns for a PN. Refreshing an open Loan File then flags the change for the LA and Supervisor; transactions are never changed.</p>
      <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
        <div className="w-44"><label htmlFor="mo-pn" className="label">PN</label><input id="mo-pn" name="pn" required className="input" placeholder="PN-0001001" /></div>
        <div className="w-44"><label htmlFor="mo-amt" className="label">New amount (PHP)</label><input id="mo-amt" name="amount" inputMode="decimal" className="input" placeholder="550000" /></div>
        <SubmitButton>Apply</SubmitButton>
        <SubmitButton className="btn-secondary" name="$clear" value="1">Clear for this PN</SubmitButton>
      </form>
      <div className="mt-2"><FormMessage state={state} /></div>
      {current.length > 0 && (
        <ul className="mt-2 text-xs text-ink-2">
          {current.map(([pn, o]) => <li key={pn}><span className="mono">{pn}</span>: amount {o.totalReleasedAmount?.toLocaleString("en-PH")}</li>)}
        </ul>
      )}
    </div>
  );
}

/**
 * Add / Edit user, inside the Users pop-up. The footer's Save button submits it (form={formId}).
 * Plain errors beside the fields. Never sets passwords or sign-in.
 */
export function UserEditForm({
  user, roles, branches, formId, listHref, effect,
}: {
  user: { id: string; name: string; email: string; roleId: string; active: boolean; branchIds: string[] } | null;
  roles: { id: string; name: string; canSignIn: boolean; builtIn: boolean; active: boolean; permissions: string[] }[];
  branches: { id: string; name: string; active: boolean }[];
  formId: string;
  listHref: string;
  /** What making this user inactive does (asked before saving). */
  effect: string;
}) {
  const router = useRouter();
  const [confirmOff, setConfirmOff] = useState(false);
  const [roleChange, setRoleChange] = useState<{ lose: string[]; gain: string[]; to: string } | null>(null);
  const roleConfirmed = useRef(false);
  const confirmed = useRef(false);
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof saveUserAction>>, fd: FormData) => {
    const r = await saveUserAction(prev, fd);
    if (r?.ok) {
      window.dispatchEvent(new Event(SAVED_EVENT));
      if (!user) router.push(listHref, { scroll: false });
    }
    return r;
  }, null);
  const uid = user?.id ?? "new";
  const err = (name: string) => (state && !state.ok && state.field === name ? state.error : undefined);
  const general = state && !state.ok && !["name", "email", "roleId", "branchIds", "active"].includes(state.field ?? "") ? state.error : undefined;
  const fieldErr = (name: string) => err(name) && <p id={`u-${name}-${uid}-err`} className="mt-1.5 text-sm text-bad-fg">{err(name)}</p>;
  return (
    <form
      id={formId} data-track-dirty className="flex flex-col gap-4"
      onSubmit={(e) => {
        // Switching an active user off asks first, in plain words, before saving.
        const on = (e.currentTarget.elements.namedItem("active") as HTMLInputElement | null)?.checked;
        if (user?.active && on === false && !confirmed.current) { e.preventDefault(); setConfirmOff(true); return; }
        // Changing someone's role says what they lose and gain, first.
        const newRoleId = (e.currentTarget.elements.namedItem("roleId") as HTMLSelectElement | null)?.value;
        if (user && newRoleId && newRoleId !== user.roleId && !roleConfirmed.current) {
          const from = roles.find((r) => r.id === user.roleId);
          const to = roles.find((r) => r.id === newRoleId);
          if (from && to) {
            e.preventDefault();
            setRoleChange({ lose: from.permissions.filter((p) => !to.permissions.includes(p)), gain: to.permissions.filter((p) => !from.permissions.includes(p)), to: to.name });
            return;
          }
        }
        confirmed.current = false;
        roleConfirmed.current = false;
        setConfirmOff(false);
        setRoleChange(null);
        submitKeepingValues(e, action);
      }}
    >
      {user && <input type="hidden" name="id" value={user.id} />}
      {/* Both questions open in the shared confirm window; confirming submits this form. */}
      <ConfirmDialog
        open={!!roleChange}
        title={`Change the role of ${user?.name} to ${roleChange?.to}?`}
        body={<>{user?.name} will lose: {roleChange?.lose.length ? roleChange.lose.join(", ") : "nothing"}. And gain: {roleChange?.gain.length ? roleChange.gain.join(", ") : "nothing"}.</>}
        cancelLabel="Keep editing"
        confirmLabel="Change role and save"
        onCancel={() => setRoleChange(null)}
        onConfirm={() => { roleConfirmed.current = true; setRoleChange(null); (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit(); }}
      />
      <ConfirmDialog
        open={confirmOff}
        title={`Make ${user?.name} inactive?`}
        body={effect}
        cancelLabel="Keep editing"
        confirmLabel="Make inactive and save"
        onCancel={() => setConfirmOff(false)}
        onConfirm={() => { confirmed.current = true; setConfirmOff(false); (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit(); }}
      />
      {state?.ok && <p role="status" className="rounded-xl bg-ok-bg px-4 py-2.5 text-sm font-semibold text-ok-fg">Saved</p>}
      {general && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-2.5 text-sm text-bad-fg">{general}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`u-name-${uid}`} className="label">Name</label>
          <input id={`u-name-${uid}`} name="name" defaultValue={user?.name} className="input" aria-invalid={!!err("name")} aria-describedby={err("name") ? `u-name-${uid}-err` : undefined} />
          {fieldErr("name")}
        </div>
        <div>
          <label htmlFor={`u-email-${uid}`} className="label">Email</label>
          <input id={`u-email-${uid}`} name="email" type="email" defaultValue={user?.email} readOnly={!!user} className={`input ${user ? "bg-fill" : ""}`} aria-invalid={!!err("email")} aria-describedby={err("email") ? `u-email-${uid}-err` : undefined} />
          {user ? <p className="help">The email cannot change.</p> : <p className="help">Use a @gdfi.ph email.</p>}
          {fieldErr("email")}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`u-role-${uid}`} className="label">Role</label>
          <select id={`u-role-${uid}`} name="roleId" defaultValue={user?.roleId ?? roles.find((r) => r.canSignIn)?.id} className="input" aria-invalid={!!err("roleId")}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}{!r.active ? " · Inactive" : r.canSignIn ? "" : r.builtIn ? " (not signed in yet)" : " (test users in test mode)"}</option>)}
          </select>
          <p className="help">Built-in roles that may sign in: Admin and Loan Associate. Custom roles: test users in test mode only.</p>
          {fieldErr("roleId")}
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="label">Branches</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {branches.filter((b) => b.active || user?.branchIds.includes(b.id)).map((b) => (
              <label key={b.id} className="inline-flex min-h-11 items-center gap-2.5 text-[15px]">
                <input type="checkbox" name="branchIds" value={b.id} defaultChecked={user?.branchIds.includes(b.id)} className="h-5 w-5 accent-[var(--navy)]" />
                {b.name}{!b.active && <span className="chip c-mute h-6 text-xs">Inactive</span>}
              </label>
            ))}
          </div>
          {fieldErr("branchIds")}
        </fieldset>
        <div className="sm:col-span-2">
          <label htmlFor={`u-active-${uid}`} className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-[15px] font-medium">
            <input id={`u-active-${uid}`} type="checkbox" role="switch" name="active" defaultChecked={user?.active ?? true} className="h-5 w-5 accent-[var(--navy)]" />
            Active
          </label>
          <p className="help -mt-1 ml-8">Inactive users cannot sign in or be picked for new work. Nothing is deleted.</p>
          {fieldErr("active")}
        </div>
      </div>
    </form>
  );
}

/**
 * Edit form shown as the second step inside a Settings modal. The modal footer's Save button
 * submits it (form={formId}). Same fields, same server action and validation as before.
 */
export function SettingsEditForm({ kind, id, fields, formId, listHref }: { kind: string; id: string | null; fields: FieldDef[]; formId: string; listHref: string }) {
  const router = useRouter();
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof saveSettingsAction>>, fd: FormData) => {
    const r = await saveSettingsAction(prev, fd);
    if (r?.ok) {
      window.dispatchEvent(new Event(SAVED_EVENT));
      if (!id) router.push(listHref, { scroll: false });
    }
    return r;
  }, null);
  const uid = `${kind}-${id ?? "new"}`;
  const fieldError = (name: string) => (state && !state.ok && state.field === name ? state.error : undefined);
  const general = state && !state.ok && !fields.some((f) => f.name === state.field) ? state.error : undefined;
  // Checkboxes are controlled so a dependent switch follows the one it needs.
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(fields.filter((f) => f.type === "checkbox").map((f) => [f.name, !!f.value])));
  const [switchedOff, setSwitchedOff] = useState<string[]>([]);
  const toggle = (name: string, value: boolean) => {
    const next = { ...on, [name]: value };
    const off: string[] = [];
    for (const f of fields) if (f.dependsOn === name && !value && next[f.name]) { next[f.name] = false; off.push(f.name); }
    setOn(next);
    setSwitchedOff(value ? switchedOff.filter((n) => !fields.some((f) => f.name === n && f.dependsOn === name)) : [...new Set([...switchedOff, ...off])]);
  };
  return (
    <form id={formId} onSubmit={(e) => submitKeepingValues(e, action)} data-track-dirty className="flex flex-col gap-4">
      <input type="hidden" name="kind" value={kind} />
      {id && <input type="hidden" name="id" value={id} />}
      {state?.ok && <p role="status" className="rounded-xl bg-ok-bg px-4 py-2.5 text-sm font-semibold text-ok-fg">Saved</p>}
      {general && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-2.5 text-sm text-bad-fg">{general}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const fid = `${uid}-${f.name}`;
          const err = fieldError(f.name);
          if (f.type === "checkbox") {
            const locked = !!f.dependsOn && !on[f.dependsOn];
            return (
              <div key={f.name} className={`sm:col-span-2 ${f.dependsOn ? "ml-8 -mt-2" : ""}`}>
                <input type="hidden" name={`$has_${f.name}`} value="1" />
                <label htmlFor={fid} className={`inline-flex min-h-11 items-center gap-3 text-[15px] font-medium ${locked ? "cursor-not-allowed text-ink-2" : "cursor-pointer"}`}>
                  <input id={fid} type="checkbox" name={f.name} checked={!!on[f.name]} disabled={locked} onChange={(e) => toggle(f.name, e.target.checked)}
                    className="h-5 w-5 accent-[var(--navy)]" aria-describedby={f.help ? `${fid}-h` : undefined} />
                  {f.label}
                </label>
                {f.help && <p id={`${fid}-h`} className="help -mt-1 ml-8">{f.help}</p>}
                {switchedOff.includes(f.name) && f.offNote && <p role="status" className="ml-8 mt-1 text-[13px] font-semibold text-act-fg">{f.offNote}</p>}
                {err && <p id={`${fid}-err`} className="ml-8 mt-1 text-sm text-bad-fg">{err}</p>}
              </div>
            );
          }
          if (f.type === "evidence") {
            return (
              <div key={f.name} className="sm:col-span-2">
                <EvidenceFieldsEditor id={fid} name={f.name} label={f.label} initial={String(f.value ?? "[]")} error={err} />
              </div>
            );
          }
          return (
            <div key={f.name} className={f.width === "lg" ? "sm:col-span-2" : ""}>
              <label htmlFor={fid} className="label">{f.label}</label>
              {f.type === "select" && f.readOnly ? (
                <>
                  <input type="hidden" name={f.name} value={String(f.value ?? "")} />
                  <select id={fid} value={String(f.value ?? "")} disabled className="input bg-fill" onChange={() => {}}>
                    {f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </>
              ) : f.type === "select" ? (
                <select id={fid} name={f.name} defaultValue={String(f.value ?? "")} className="input" aria-invalid={!!err} aria-describedby={err ? `${fid}-err` : undefined}>
                  {f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : (
                <input
                  id={fid}
                  name={f.name}
                  type={f.type === "number" ? "text" : f.type}
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  defaultValue={f.value === null || f.value === undefined ? "" : String(f.value)}
                  readOnly={f.readOnly}
                  className={`input ${f.readOnly ? "bg-fill" : ""}`}
                  aria-invalid={!!err}
                  aria-describedby={err ? `${fid}-err` : undefined}
                />
              )}
              {f.help && !err && <p className="help">{f.help}</p>}
              {err && <p id={`${fid}-err`} className="mt-1.5 text-sm text-bad-fg">{err}</p>}
            </div>
          );
        })}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Processing stages: the ordered evidence fields of one stage
// ---------------------------------------------------------------------------

type EvField = { key?: string; label: string; type: string; required: boolean };
const EV_TYPES: [string, string][] = [["text", "Text"], ["date", "Date"], ["number", "Number"], ["file", "File"], ["tick", "Tick (yes)"]];

/** Add, rename, reorder and remove evidence fields. Saved as one hidden value with the form. */
function EvidenceFieldsEditor({ id, name, label, initial, error }: { id: string; name: string; label: string; initial: string; error?: string }) {
  const [rows, setRows] = useState<EvField[]>(() => { try { return JSON.parse(initial) as EvField[]; } catch { return []; } });
  const set = (i: number, patch: Partial<EvField>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => { const n = [...rows]; [n[i], n[i + d]] = [n[i + d], n[i]]; setRows(n); };
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${id}-err` : `${id}-h`} data-evidence-editor>
      <legend className="label">{label}</legend>
      <input type="hidden" name={name} value={JSON.stringify(rows)} />
      {rows.length === 0 && <p className="text-sm text-ink-2">No evidence fields. The processor only presses Start and Finish.</p>}
      <ol className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-line p-2 sm:grid-cols-[1fr_9rem_auto_auto]" data-evidence-row>
            <input aria-label={`Field ${i + 1} label`} value={r.label} maxLength={60} onChange={(e) => set(i, { label: e.target.value })} className="input" />
            <select aria-label={`Field ${i + 1} type`} value={r.type} onChange={(e) => set(i, { type: e.target.value })} className="input">
              {EV_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={r.required} onChange={(e) => set(i, { required: e.target.checked })} className="h-5 w-5 accent-[var(--navy)]" />Required</label>
            <span className="flex items-center gap-1">
              <button type="button" className="btn-ghost btn-sm min-h-11" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${r.label || "field"} up`}>Up</button>
              <button type="button" className="btn-ghost btn-sm min-h-11" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${r.label || "field"} down`}>Down</button>
              <button type="button" className="btn-ghost btn-sm min-h-11" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove ${r.label || "field"}`}>Remove</button>
            </span>
          </li>
        ))}
      </ol>
      <div><button type="button" className="btn-secondary btn-sm" onClick={() => setRows([...rows, { label: "", type: "text", required: true }])}>Add field</button></div>
      {!error && <p id={`${id}-h`} className="help">In order. Required fields must be filled before the stage can finish (checked on the server too).</p>}
      {error && <p id={`${id}-err`} className="text-sm text-bad-fg">{error}</p>}
    </fieldset>
  );
}
