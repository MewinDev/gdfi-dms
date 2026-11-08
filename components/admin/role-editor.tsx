"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useMemo, useState } from "react";
import { roleCommandAction, saveRoleAction } from "@/app/actions/admin";
import {
  PERMISSION_GROUPS, WORKFLOW_PERMISSIONS, dependentsOf, permissionLabel, plainWords, withRequirements,
} from "@/lib/auth/permissions";
import { ChevronDownIcon, SearchIcon } from "@/components/ui/icons";
import { SAVED_EVENT } from "./settings-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export interface RoleEditorRole {
  id: string | null;
  name: string;
  description: string;
  branchAccess: "ASSIGNED" | "ALL";
  permissions: string[];
  builtIn: boolean;
  locked: boolean;
  active: boolean;
}

type Pending = { message: string; next: Set<string> } | null;

const list = (keys: string[]) => keys.map(permissionLabel).join(", ");

/**
 * Role step: name, description, branch access, and the permission switches grouped by area.
 * Turning a switch on also turns on what it needs; turning one off also turns off what needs it.
 * Both are explained in plain words before they are applied. Nothing is saved until Save.
 */
export function RoleEditor({
  role, copyFrom, people, peopleHref, formId, listHref, editHrefBase,
}: {
  role: RoleEditorRole;
  copyFrom: { id: string; name: string; permissions: string[]; branchAccess: "ASSIGNED" | "ALL" }[];
  people: { id: string; name: string; email: string }[];
  peopleHref: string;
  formId: string;
  listHref: string;
  /** "/admin/settings?open=roles&edit=" */
  editHrefBase: string;
}) {
  const router = useRouter();
  const [perms, setPerms] = useState<Set<string>>(() => new Set(role.permissions));
  const [branchAccess, setBranchAccess] = useState(role.branchAccess);
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof saveRoleAction>>, fd: FormData) => {
    const r = await saveRoleAction(prev, fd);
    if (r?.ok) {
      window.dispatchEvent(new Event(SAVED_EVENT));
      if (!role.id) router.push(listHref, { scroll: false });
    }
    return r;
  }, null);
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : undefined);
  const general = state && !state.ok && !["name", "description", "branchAccess"].includes(state.field ?? "") ? state.error : undefined;
  const disabled = role.locked;
  const needle = q.trim().toLowerCase();
  const words = useMemo(() => plainWords(perms, branchAccess), [perms, branchAccess]);

  function propose(next: Set<string>, message: string | null) {
    if (message) setPending({ message, next });
    else { setPerms(next); setPending(null); }
  }
  function toggle(key: string, on: boolean) {
    if (on) {
      const next = withRequirements([...perms, key]);
      const extra = [...next].filter((k) => !perms.has(k) && k !== key);
      propose(next, extra.length ? `Turning on ${permissionLabel(key)} also turns on ${list(extra)}, because it needs ${extra.length === 1 ? "it" : "them"}.` : null);
    } else {
      const deps: string[] = dependentsOf(key).filter((k) => perms.has(k));
      const next = new Set([...perms].filter((k) => k !== key && !deps.includes(k)));
      propose(next, deps.length ? `Turning off ${permissionLabel(key)} also turns off ${list(deps)}, because ${deps.length === 1 ? "it needs" : "they need"} it.` : null);
    }
  }
  function setGroup(keys: string[], on: boolean, label: string) {
    if (on) {
      const next = withRequirements([...perms, ...keys]);
      const extra = [...next].filter((k) => !perms.has(k) && !keys.includes(k));
      propose(next, extra.length ? `Turning on all of ${label} also turns on ${list(extra)}, because they are needed.` : null);
    } else {
      const deps: string[] = [...new Set<string>(keys.flatMap((k) => dependentsOf(k)))].filter((k) => perms.has(k) && !keys.includes(k));
      const next = new Set([...perms].filter((k) => !keys.includes(k) && !deps.includes(k)));
      propose(next, deps.length ? `Turning off all of ${label} also turns off ${list(deps)}, because they need it.` : null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
      <form
        id={formId} data-track-dirty className="flex min-w-0 flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => action(fd));
        }}
      >
        {role.id && <input type="hidden" name="id" value={role.id} />}
        {[...perms].map((k) => <input key={k} type="hidden" name="permissions" value={k} />)}
        {state?.ok && <p role="status" className="rounded-xl bg-ok-bg px-4 py-2.5 text-sm font-semibold text-ok-fg">Saved</p>}
        {general && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-2.5 text-sm text-bad-fg">{general}</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="role-name" className="label">Name</label>
            <input id="role-name" name="name" defaultValue={role.name} readOnly={role.builtIn} className={`input ${role.builtIn ? "bg-fill" : ""}`} aria-invalid={!!err("name")} aria-describedby={err("name") ? "role-name-err" : undefined} />
            {role.builtIn ? <p className="help">Built-in role names cannot change.</p> : <p className="help">2 to 40 characters. Must be unique.</p>}
            {err("name") && <p id="role-name-err" className="mt-1.5 text-sm text-bad-fg">{err("name")}</p>}
          </div>
          <div>
            <label htmlFor="role-description" className="label">Description</label>
            <input id="role-description" name="description" defaultValue={role.description} className="input" aria-invalid={!!err("description")} />
            {err("description") && <p className="mt-1.5 text-sm text-bad-fg">{err("description")}</p>}
          </div>
          <fieldset className="sm:col-span-2" disabled={disabled}>
            <legend className="label">Branch access</legend>
            <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
              {([["ASSIGNED", "Only the branches the person is assigned to"], ["ALL", "All branches"]] as const).map(([v, l]) => (
                <label key={v} className="inline-flex min-h-11 items-center gap-2.5 text-[15px]">
                  <input type="radio" name="branchAccess" value={v} checked={branchAccess === v} onChange={() => setBranchAccess(v)} className="h-5 w-5 accent-[var(--navy)]" />
                  {l}
                </label>
              ))}
            </div>
            {disabled && <input type="hidden" name="branchAccess" value="ALL" />}
          </fieldset>
        </div>

        {disabled ? (
          <p className="rounded-xl bg-cream px-4 py-3 text-sm">
            <strong>Admin is locked.</strong> It always has every permission and all branches, so nobody can lock themselves out. The loan-file steps (Open a loan file, Check documents, Processing) belong to the roles that do them and stay off for Admin, as before.
          </p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="perm-search" className="label">Find a switch</label>
              <div className="flex h-[46px] items-center gap-2.5 rounded-xl border border-line-input bg-fill-soft px-4 focus-within:border-navy focus-within:bg-white">
                <span className="text-ink-2"><SearchIcon size={18} /></span>
                <input id="perm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. labels" autoComplete="off" className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none focus-visible:outline-none" />
              </div>
            </div>
            <div className="sm:w-60">
              <label htmlFor="copy-from" className="label">Copy from another role</label>
              <select
                id="copy-from" className="input" value=""
                onChange={(e) => {
                  const r = copyFrom.find((x) => x.id === e.target.value);
                  if (!r) return;
                  setPerms(new Set(r.permissions));
                  setBranchAccess(r.branchAccess);
                  setPending(null);
                  setCopied(r.name);
                }}
              >
                <option value="">Pick a role…</option>
                {copyFrom.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>
        )}
        {copied && <p role="status" className="text-sm text-ink-2">Switches copied from {copied}. Nothing is saved until Save.</p>}

        {pending && (
          <div role="alert" className="rounded-xl bg-cream p-4">
            <p className="text-[15px]">{pending.message}</p>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-ghost" onClick={() => setPending(null)}>Cancel</button>
              <button type="button" className="btn-navy" onClick={() => { setPerms(pending.next); setPending(null); }}>OK, change them</button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {PERMISSION_GROUPS.map((g) => {
            const items = g.items.filter((i) => !needle || `${i.label} ${i.help} ${g.label}`.toLowerCase().includes(needle));
            if (items.length === 0) return null;
            const on = g.items.filter((i) => perms.has(i.key)).length;
            const open = needle ? true : !closed.has(g.key);
            const keys = g.items.map((i) => i.key as string);
            return (
              <section key={g.key} aria-label={g.label} className="rounded-xl border border-line">
                <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <button
                    type="button" aria-expanded={open} aria-controls={`grp-${g.key}`}
                    onClick={() => setClosed((c) => { const n = new Set(c); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className={`transition-transform ${open ? "" : "-rotate-90"}`}><ChevronDownIcon size={18} /></span>
                    <span className="text-[15px] font-bold text-navy">{g.label}</span>
                    <span className="text-sm text-ink-2">{on} of {g.items.length} on</span>
                  </button>
                  {!disabled && (
                    <span className="flex gap-1 text-sm">
                      <button type="button" className="link min-h-11 px-1.5" onClick={() => setGroup(keys, true, g.label)} aria-label={`Turn on all of ${g.label}`}>All</button>
                      <span aria-hidden="true" className="self-center text-ink-2">/</span>
                      <button type="button" className="link min-h-11 px-1.5" onClick={() => setGroup(keys, false, g.label)} aria-label={`Turn off all of ${g.label}`}>None</button>
                    </span>
                  )}
                </div>
                {open && (
                  <ul id={`grp-${g.key}`} className="divide-y divide-[rgb(12_35_64/0.08)] border-t border-line">
                    {items.map((i) => {
                      const id = `perm-${i.key.replace(/[^a-z]/g, "-")}`;
                      return (
                        <li key={i.key} className="flex items-start gap-3 px-4 py-3">
                          <input
                            id={id} type="checkbox" role="switch" checked={perms.has(i.key)} disabled={disabled}
                            onChange={(e) => toggle(i.key, e.target.checked)}
                            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--navy)]" aria-describedby={`${id}-help`}
                          />
                          <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                            <span className="block text-[15px] font-semibold">{i.label}</span>
                            <span id={`${id}-help`} className="block text-sm text-ink-2">
                              {i.help}
                              {disabled && WORKFLOW_PERMISSIONS.includes(i.key) ? " (Belongs to the roles that do it.)" : ""}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </form>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-0">
        <section aria-labelledby="plain-words" className="rounded-xl bg-fill p-4">
          <h3 id="plain-words" className="text-[15px] font-bold text-navy">In plain words</h3>
          <ul aria-live="polite" className="mt-2 flex flex-col gap-1.5 text-sm">
            {words.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </section>
        {role.id && (
          <section aria-labelledby="who-has" className="rounded-xl border border-line p-4">
            <h3 id="who-has" className="text-[15px] font-bold text-navy">Who has this role</h3>
            {people.length === 0 ? (
              <p className="mt-1 text-sm text-ink-2">Nobody yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {people.slice(0, 8).map((p) => <li key={p.id}><span className="font-semibold">{p.name}</span> <span className="text-ink-2">{p.email}</span></li>)}
                {people.length > 8 && <li className="text-ink-2">and {people.length - 8} more</li>}
              </ul>
            )}
            <Link href={peopleHref} className="link mt-2 inline-flex min-h-11 items-center text-sm">See them in Users</Link>
          </section>
        )}
        {role.id && <RoleCommands role={role} peopleCount={people.length} peopleHref={peopleHref} editHrefBase={editHrefBase} />}
      </aside>
    </div>
  );
}

/** Duplicate, Reset to default (built-in), Make inactive / active. Each asks first where it changes something. */
function RoleCommands({ role, peopleCount, peopleHref, editHrefBase }: { role: RoleEditorRole; peopleCount: number; peopleHref: string; editHrefBase: string }) {
  const router = useRouter();
  const [ask, setAsk] = useState<null | "reset" | "inactive">(null);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof roleCommandAction>>, fd: FormData) => {
    const r = await roleCommandAction(prev, fd);
    if (r?.ok) {
      setAsk(null);
      window.dispatchEvent(new Event(SAVED_EVENT));
      if (r.roleId) router.push(`${editHrefBase}${r.roleId}`, { scroll: false });
    }
    return r;
  }, null);
  const cmd = (c: string, label: string, cls = "btn-ghost btn-sm") => (
    <form action={action}>
      <input type="hidden" name="id" value={role.id!} />
      <input type="hidden" name="cmd" value={c} />
      <button type="submit" disabled={pending} className={cls}>{label}</button>
    </form>
  );
  return (
    <section aria-label="Role actions" className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <p className="text-sm">
        <span className="font-semibold text-navy">Status: </span>
        {role.active ? <span className="chip c-ok h-6 text-xs">Active</span> : <span className="chip c-mute h-6 text-xs">Inactive</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        {cmd("duplicate", "Duplicate")}
        {role.builtIn && !role.locked && <button type="button" className="btn-ghost btn-sm" onClick={() => setAsk("reset")}>Reset to default</button>}
        {!role.locked && (role.active
          ? <button type="button" className="btn-ghost btn-sm" onClick={() => setAsk("inactive")}>Make inactive</button>
          : cmd("active", "Make active"))}
      </div>
      {/* Questions open in the shared confirm window; confirming submits one of these forms. */}
      {(["reset", "inactive"] as const).map((c) => (
        <form key={c} id={`role-${c}-${role.id}`} action={action} hidden>
          <input type="hidden" name="id" value={role.id!} />
          <input type="hidden" name="cmd" value={c} />
        </form>
      ))}
      <ConfirmDialog
        open={ask === "reset"}
        title={`Reset ${role.name} to default?`}
        body={`Put ${role.name} back to its original switches, branch access and description. Changes made since are undone. Saved straight away.`}
        confirmLabel="Reset to default"
        confirmForm={`role-reset-${role.id}`}
        pending={pending}
        onCancel={() => setAsk(null)}
      />
      <ConfirmDialog
        open={ask === "inactive"}
        title={peopleCount > 0 ? "Move people first" : `Make ${role.name} inactive?`}
        body={peopleCount > 0
          ? `${peopleCount} ${peopleCount === 1 ? "person has" : "people have"} this role. Move them to another role first, then make it inactive.`
          : "Nobody has this role. Once inactive it cannot be given to anyone until it is made active again. Nothing is deleted. Make inactive?"}
        cancelLabel={peopleCount > 0 ? "OK" : "Keep it active"}
        confirmLabel={peopleCount > 0 ? "Open Users with this role" : "Make inactive"}
        confirmForm={peopleCount > 0 ? undefined : `role-inactive-${role.id}`}
        onConfirm={peopleCount > 0 ? () => { setAsk(null); router.push(peopleHref); } : undefined}
        pending={pending}
        onCancel={() => setAsk(null)}
      />
      {state && !state.ok && <p role="alert" className="text-sm text-bad-fg">{state.error}</p>}
      {state?.ok && !state.roleId && <p role="status" className="text-sm font-semibold text-ok-fg">{state.message}</p>}
    </section>
  );
}
