"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, startTransition, useActionState, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { roleCheckAction, roleCommandAction, saveRoleAction } from "@/app/actions/admin";
import { VISIBLE_PERMISSION_GROUPS, isHiddenPermission, permissionLabel, plainWords, type PermissionDef } from "@/lib/auth/permissions";
import { tick, tickMany } from "@/lib/roles/impact";
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
  active: boolean;
}

type Check = { text: string; added: string[]; removed: string[]; users: number; lockout: string | null };

const TECH_KEY = "roles.showTechnicalNames";
const readTech = () => { try { return window.localStorage.getItem(TECH_KEY) === "1"; } catch { return false; } };
const noSubscribe = () => () => {};
const writeTech = (on: boolean) => { try { window.localStorage.setItem(TECH_KEY, on ? "1" : "0"); } catch { /* private window: not remembered */ } };

/** A group's rows: a tick on its own, or a View tick and its Change tick side by side. */
type Row = { kind: "one"; item: PermissionDef } | { kind: "pair"; view: PermissionDef; change: PermissionDef };
function rowsOf(items: PermissionDef[]): Row[] {
  const changeOf = new Map(items.filter((i) => i.view && items.some((v) => v.key === i.view)).map((i) => [i.view as string, i]));
  const inPair = new Set([...changeOf.values()].map((i) => i.key as string));
  const out: Row[] = [];
  for (const i of items) {
    if (inPair.has(i.key)) continue;
    const change = changeOf.get(i.key);
    out.push(change ? { kind: "pair", view: i, change } : { kind: "one", item: i });
  }
  return out;
}

/**
 * Settings > Roles, one role: name, description, branch access for new users, and the ticks grouped by
 * area in plain words ("roles are just ticks"). Ticking a Change also ticks its View; unticking a View
 * also unticks its Change (and so on for everything a tick needs), said in one short line. Before Save
 * the server says who gains or loses what, and refuses (with the reason) a change that would lock
 * everybody out of managing roles or branch access. Removing anything asks first.
 */
export function RoleEditor({
  role, copyFrom, people, usedBy, peopleHref, formId, listHref, editHrefBase,
}: {
  role: RoleEditorRole;
  copyFrom: { id: string; name: string; permissions: string[]; branchAccess: "ASSIGNED" | "ALL" }[];
  people: { id: string; name: string; email: string }[];
  /** Active users with this role. */
  usedBy: number;
  peopleHref: string;
  formId: string;
  listHref: string;
  /** "/admin/settings?open=roles&edit=" */
  editHrefBase: string;
}) {
  const router = useRouter();
  const [perms, setPerms] = useState<Set<string>>(() => new Set(role.permissions));
  // Hidden ticks (a feature switched off for now) stay on the role and are saved with it, but are not counted.
  const shown = [...perms].filter((k) => !isHiddenPermission(k)).length;
  const [branchAccess, setBranchAccess] = useState(role.branchAccess);
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ id: string; name: string } | null>(null);
  const storedTech = useSyncExternalStore(noSubscribe, readTech, () => false);
  const [techSet, setTech] = useState<boolean | null>(null);
  const tech = techSet ?? storedTech;
  const [checked, setCheck] = useState<(Check & { key: string }) | null>(null);
  const [confirmFd, setConfirmFd] = useState<FormData | null>(null);
  const [state, action, saving] = useActionState(async (prev: Awaited<ReturnType<typeof saveRoleAction>>, fd: FormData) => {
    const r = await saveRoleAction(prev, fd);
    if (r?.ok) {
      window.dispatchEvent(new Event(SAVED_EVENT));
      if (!role.id) router.push(listHref, { scroll: false });
    }
    return r;
  }, null);
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : undefined);
  const general = state && !state.ok && !["name", "description", "branchAccess"].includes(state.field ?? "") ? state.error : undefined;
  const needle = q.trim().toLowerCase();
  const words = useMemo(() => plainWords(perms, branchAccess), [perms, branchAccess]);
  const permKey = useMemo(() => [...perms].sort().join(","), [perms]);
  const initialKey = useMemo(() => [...role.permissions].sort().join(","), [role.permissions]);
  const lockoutRef = useRef<HTMLDivElement>(null);
  // The server's answer for the ticks as they are now (none while nothing changed).
  const check = checked && checked.key === permKey && permKey !== initialKey ? checked : null;

  // The impact and lock-out check, a moment after the ticks change (existing roles only).
  useEffect(() => {
    if (!role.id || permKey === initialKey) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await roleCheckAction({ id: role.id, permissions: permKey ? permKey.split(",") : [] });
      if (live && r.ok) setCheck({ ...r, key: permKey });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [permKey, initialKey, role.id]);

  // While a lock-out reason shows, the Save button in the window's footer is off (the server refuses anyway).
  useEffect(() => {
    const save = document.querySelector<HTMLButtonElement>(`button[type="submit"][form="${formId}"]`);
    if (!save) return;
    save.disabled = !!check?.lockout;
    if (check?.lockout) save.setAttribute("aria-describedby", "role-lockout"); else save.removeAttribute("aria-describedby");
    return () => { save.disabled = false; save.removeAttribute("aria-describedby"); };
  }, [check?.lockout, formId]);

  function apply(r: { next: Set<string>; note: string | null }) {
    setPerms(r.next);
    setNote(r.note);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (role.id) {
      const r = await roleCheckAction({ id: role.id, permissions: [...perms] });
      if (r.ok) {
        setCheck({ ...r, key: permKey });
        if (r.lockout) { lockoutRef.current?.focus(); return; }
        if (r.removed.length) { setConfirmFd(fd); return; }
      }
    }
    startTransition(() => action(fd));
  }

  const matches = (i: PermissionDef, groupLabel: string) =>
    !needle || `${i.label} ${i.help} ${groupLabel}${tech ? ` ${i.key}` : ""}`.toLowerCase().includes(needle);

  const tickBox = (i: PermissionDef, tag?: "View" | "Change") => {
    const id = `perm-${i.key.replace(/[^a-z]/g, "-")}`;
    return (
      <div className="flex min-w-0 flex-1 items-start gap-3" data-perm={i.key}>
        <input
          id={id} type="checkbox" checked={perms.has(i.key)}
          onChange={(e) => apply(tick(perms, i.key, e.target.checked))}
          className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--navy)]" aria-describedby={`${id}-help`}
        />
        <label htmlFor={id} className="min-h-11 min-w-0 flex-1 cursor-pointer">
          {tag && <span className="block text-[11px] font-bold uppercase tracking-wide text-ink-2">{tag}</span>}
          <span className="block text-[15px] font-semibold">{i.label}</span>
          <span id={`${id}-help`} className="block text-sm text-ink-2">{i.help}</span>
          {tech && <span className="mt-0.5 block font-mono text-xs text-ink-2" data-tech-name>Technical name: {i.key}</span>}
        </label>
      </div>
    );
  };

  const removedWords = check?.removed.map(permissionLabel).join(", ") ?? "";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
      <form id={formId} data-track-dirty className="flex min-w-0 flex-col gap-5" onSubmit={onSubmit}>
        {role.id && <input type="hidden" name="id" value={role.id} />}
        {!role.id && copied && <input type="hidden" name="copiedFromId" value={copied.id} />}
        {[...perms].map((k) => <input key={k} type="hidden" name="permissions" value={k} />)}
        {state?.ok && <p role="status" className="rounded-xl bg-ok-bg px-4 py-2.5 text-sm font-semibold text-ok-fg">Saved</p>}
        {general && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-2.5 text-sm text-bad-fg">{general}</p>}

        <div className="flex flex-wrap gap-2 text-sm" aria-live="polite">
          <span className="chip c-navy h-7" data-tick-count={shown}>{shown} {shown === 1 ? "permission" : "permissions"} ticked</span>
          {role.id && <span className="chip c-mute h-7" data-used-by={usedBy}>Used by {usedBy} {usedBy === 1 ? "user" : "users"}</span>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="role-name" className="label">Name</label>
            <input id="role-name" name="name" defaultValue={role.name} readOnly={role.builtIn} className={`input ${role.builtIn ? "bg-fill" : ""}`} aria-invalid={!!err("name")} aria-describedby={err("name") ? "role-name-err" : undefined} />
            {role.builtIn ? <p className="help">Built-in role names cannot change. Its ticks can.</p> : <p className="help">2 to 40 characters. Must be unique.</p>}
            {err("name") && <p id="role-name-err" className="mt-1.5 text-sm text-bad-fg">{err("name")}</p>}
          </div>
          <div>
            <label htmlFor="role-description" className="label">Description</label>
            <input id="role-description" name="description" defaultValue={role.description} className="input" aria-invalid={!!err("description")} />
            {err("description") && <p className="mt-1.5 text-sm text-bad-fg">{err("description")}</p>}
          </div>
          {!role.id && (
            <div className="sm:col-span-2">
              <label htmlFor="copy-from" className="label">Copy from another role</label>
              <select
                id="copy-from" className="input sm:max-w-sm" value={copied?.id ?? ""}
                onChange={(e) => {
                  const r = copyFrom.find((x) => x.id === e.target.value);
                  if (!r) { setCopied(null); return; }
                  setPerms(new Set(r.permissions));
                  setBranchAccess(r.branchAccess);
                  setNote(null);
                  setCopied({ id: r.id, name: r.name });
                }}
              >
                <option value="">Start empty</option>
                {copyFrom.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {copied ? <p role="status" className="help" data-copied>Ticks and branch access copied from {copied.name}. Change them, then Save.</p> : <p className="help">Starts with the same ticks as that role.</p>}
            </div>
          )}
          <fieldset className="sm:col-span-2">
            <legend className="label">Branch access for new users</legend>
            <p className="help -mt-1">Where each person works is set per user (Users, Edit, Branch access). This is only what a new user of this role starts with.</p>
            <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
              {([["ASSIGNED", "Selected branches (picked per user)"], ["ALL", "All branches"]] as const).map(([v, l]) => (
                <label key={v} className="inline-flex min-h-11 items-center gap-2.5 text-[15px]">
                  <input type="radio" name="branchAccess" value={v} checked={branchAccess === v} onChange={() => setBranchAccess(v)} className="h-5 w-5 accent-[var(--navy)]" />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="perm-search" className="label">Find a permission</label>
            <div className="flex h-[46px] items-center gap-2.5 rounded-xl border border-line-input bg-fill-soft px-4 focus-within:border-navy focus-within:bg-white">
              <span className="text-ink-2"><SearchIcon size={18} /></span>
              <input id="perm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. refresh" autoComplete="off" className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none focus-visible:outline-none" />
            </div>
          </div>
          <label className="inline-flex min-h-11 items-center gap-2.5 text-sm">
            <input type="checkbox" role="switch" checked={tech} onChange={(e) => { setTech(e.target.checked); writeTech(e.target.checked); }} className="h-5 w-5 accent-[var(--navy)]" data-tech-switch />
            Show technical names
          </label>
        </div>

        {note && <p role="status" className="rounded-xl bg-cream px-4 py-2.5 text-sm" data-also-note>{note}</p>}

        {check && (
          <div className="rounded-xl bg-fill px-4 py-3 text-sm" data-impact aria-live="polite">
            <p className="font-semibold text-navy">If you save</p>
            <p>{check.text}</p>
          </div>
        )}
        {check?.lockout && (
          <div id="role-lockout" ref={lockoutRef} tabIndex={-1} role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad-fg" data-lockout>
            <p className="font-semibold">This cannot be saved</p>
            <p>{check.lockout}</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {VISIBLE_PERMISSION_GROUPS.map((g) => {
            const rows = rowsOf(g.items).filter((r) => (r.kind === "one" ? matches(r.item, g.label) : matches(r.view, g.label) || matches(r.change, g.label)));
            if (rows.length === 0) return null;
            const on = g.items.filter((i) => perms.has(i.key)).length;
            const open = needle ? true : !closed.has(g.key);
            const keys = g.items.map((i) => i.key as string);
            return (
              <section key={g.key} aria-label={g.label} className="rounded-xl border border-line" data-group={g.key}>
                <div className="flex flex-wrap items-center gap-x-2 px-4 py-1.5">
                  <button
                    type="button" aria-expanded={open} aria-controls={`grp-${g.key}`}
                    onClick={() => setClosed((c) => { const n = new Set(c); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className={`transition-transform ${open ? "" : "-rotate-90"}`}><ChevronDownIcon size={18} /></span>
                    <span className="text-[15px] font-bold text-navy">{g.label}</span>
                    <span className="text-sm text-ink-2">{on} of {g.items.length} ticked</span>
                  </button>
                  <span className="flex flex-wrap gap-x-3 text-sm">
                    <button type="button" className="link min-h-11" onClick={() => apply(tickMany(perms, keys, true, g.label))}>Tick all in this group</button>
                    <button type="button" className="link min-h-11" onClick={() => apply(tickMany(perms, keys, false, g.label))}>Clear this group</button>
                  </span>
                </div>
                {open && (
                  <ul id={`grp-${g.key}`} className="divide-y divide-[rgb(12_35_64/0.08)] border-t border-line">
                    {rows.map((r, i) => {
                      // A sub-heading where a block starts (Funds: Cash advance, Fund transfer).
                      const sub = r.kind === "one" ? r.item.subgroup : r.view.subgroup;
                      const prev = i > 0 ? (rows[i - 1].kind === "one" ? (rows[i - 1] as { item: PermissionDef }).item.subgroup : (rows[i - 1] as { view: PermissionDef }).view.subgroup) : undefined;
                      return (
                        <Fragment key={r.kind === "one" ? r.item.key : r.change.key}>
                          {sub && sub !== prev && <li className="bg-fill/60 px-4 py-2 text-sm font-bold text-navy" data-subgroup={sub}>{sub}</li>}
                          <li className={`px-4 py-3 ${r.kind === "pair" ? "flex flex-col gap-3 sm:flex-row sm:gap-6" : "flex"}`} data-pair={r.kind === "pair" ? `${r.view.key}|${r.change.key}` : undefined}>
                            {r.kind === "one" ? tickBox(r.item) : <>{tickBox(r.view, "View")}{tickBox(r.change, "Change")}</>}
                          </li>
                        </Fragment>
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
        {role.id && <RoleCommands role={role} perms={[...perms]} peopleCount={people.length} peopleHref={peopleHref} editHrefBase={editHrefBase} />}
      </aside>

      <ConfirmDialog
        open={!!confirmFd}
        title="Remove these permissions?"
        body={<span data-remove-confirm>{`${role.name} loses: ${removedWords}.`}</span>}
        detail={check?.text}
        confirmLabel="Save and remove"
        cancelLabel="Keep editing"
        pending={saving}
        onCancel={() => setConfirmFd(null)}
        onConfirm={() => { const fd = confirmFd; setConfirmFd(null); if (fd) startTransition(() => action(fd)); }}
      />
    </div>
  );
}

/** Duplicate, Reset to default (built-in), Make inactive / active. Each asks first where it changes something. */
function RoleCommands({ role, perms, peopleCount, peopleHref, editHrefBase }: { role: RoleEditorRole; perms: string[]; peopleCount: number; peopleHref: string; editHrefBase: string }) {
  const router = useRouter();
  const [ask, setAsk] = useState<null | "reset" | "inactive">(null);
  const [blocked, setBlocked] = useState<string | null>(null);
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
  async function askInactive() {
    const r = await roleCheckAction({ id: role.id, permissions: perms, active: false });
    setBlocked(r.ok ? r.lockout : null);
    setAsk("inactive");
  }
  return (
    <section aria-label="Role actions" className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <p className="text-sm">
        <span className="font-semibold text-navy">Status: </span>
        {role.active ? <span className="chip c-ok h-6 text-xs">Active</span> : <span className="chip c-mute h-6 text-xs">Inactive</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        {cmd("duplicate", "Duplicate")}
        {role.builtIn && <button type="button" className="btn-ghost btn-sm" onClick={() => setAsk("reset")}>Reset to default</button>}
        {role.active
          ? <button type="button" className="btn-ghost btn-sm" onClick={askInactive}>Make inactive</button>
          : cmd("active", "Make active")}
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
        body={`Put ${role.name} back to its original ticks, branch access and description. Changes made since are undone. Saved straight away.`}
        confirmLabel="Reset to default"
        confirmForm={`role-reset-${role.id}`}
        pending={pending}
        onCancel={() => setAsk(null)}
      />
      <ConfirmDialog
        open={ask === "inactive"}
        title={blocked ? "This role must stay active" : peopleCount > 0 ? "Move people first" : `Make ${role.name} inactive?`}
        body={blocked
          ? <span data-lockout>{blocked}</span>
          : peopleCount > 0
            ? `${peopleCount} ${peopleCount === 1 ? "person has" : "people have"} this role. Move them to another role first, then make it inactive.`
            : "Nobody has this role. Once inactive it cannot be given to anyone until it is made active again. Nothing is deleted. Make inactive?"}
        cancelLabel={blocked ? "Close" : peopleCount > 0 ? "OK" : "Keep it active"}
        confirmLabel={blocked ? "Keep it active" : peopleCount > 0 ? "Open Users with this role" : "Make inactive"}
        confirmForm={blocked || peopleCount > 0 ? undefined : `role-inactive-${role.id}`}
        onConfirm={blocked ? () => setAsk(null) : peopleCount > 0 ? () => { setAsk(null); router.push(peopleHref); } : undefined}
        pending={pending}
        onCancel={() => setAsk(null)}
      />
      {state && !state.ok && <p role="alert" className="text-sm text-bad-fg">{state.error}</p>}
      {state?.ok && !state.roleId && <p role="status" className="text-sm font-semibold text-ok-fg">{state.message}</p>}
    </section>
  );
}
