"use client";

import { useActionState, useMemo, useState } from "react";
import { saveRoleMatrixAction } from "@/app/actions/admin";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { dependentsOf, withRequirements } from "@/lib/auth/permissions";

/**
 * Settings, Permissions (D-003): every role (columns) against every permission (rows), with tickboxes.
 * Turning a tick on also turns on what it needs; turning it off also turns off what needs it (the same
 * rule as the role editor). "Review changes" lists what changes per role before anything is saved.
 * Saving needs "Manage permissions" (the Superadmin by default) and is checked again on the server:
 * lock-out (someone must keep "Manage permissions" and "Change branch access"), your own role keeps
 * "Manage permissions", and one audit row per changed role.
 */
export interface MatrixRole { id: string; name: string; builtIn: boolean; active: boolean; people: number; permissions: string[] }
export interface MatrixGroup { key: string; label: string; items: { key: string; label: string; help: string }[] }

export function PermissionMatrix({ roles, groups, editable }: { roles: MatrixRole[]; groups: MatrixGroup[]; editable: boolean }) {
  const initial = useMemo(() => new Map(roles.map((r) => [r.id, new Set(r.permissions)])), [roles]);
  const [ticks, setTicks] = useState(initial);
  const [reviewing, setReviewing] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [state, action] = useActionState(saveRoleMatrixAction, null);
  const label = useMemo(() => new Map(groups.flatMap((g) => g.items).map((i) => [i.key, i.label])), [groups]);
  const cols = roles.filter((r) => r.active || showInactive);

  const toggle = (roleId: string, key: string, on: boolean) => {
    setReviewing(false);
    setTicks((m) => {
      const next = new Set(m.get(roleId));
      if (on) for (const k of withRequirements([key])) next.add(k);
      else { next.delete(key); for (const d of dependentsOf(key)) next.delete(d); }
      return new Map(m).set(roleId, next);
    });
  };
  const diff = roles.map((r) => {
    const a = ticks.get(r.id)!;
    const b = initial.get(r.id)!;
    return { role: r, added: [...a].filter((k) => !b.has(k)), removed: [...b].filter((k) => !a.has(k)) };
  }).filter((d) => d.added.length || d.removed.length);

  return (
    <div className="flex flex-col gap-3" data-permission-matrix>
      {!editable && <p className="rounded-xl bg-fill px-3 py-2 text-sm" data-matrix-readonly>Read only. Only someone who can manage permissions (the Superadmin) changes the matrix.</p>}
      <label className="inline-flex min-h-11 items-center gap-2 text-[15px]">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-5 w-5 accent-[var(--navy)]" />
        Show inactive roles
      </label>
      {/* The table scrolls sideways inside its box; the page itself never does. */}
      <div className="max-h-[65vh] overflow-auto rounded-xl border border-line" tabIndex={0} aria-label="Permission matrix: roles across, permissions down">
        <table className="min-w-max border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-white">
            <tr>
              <th scope="col" className="sticky left-0 z-30 min-w-64 border-b border-line bg-white px-3 py-2 text-left">Permission</th>
              {cols.map((r) => (
                <th key={r.id} scope="col" className="min-w-24 border-b border-l border-line px-2 py-2 text-center align-bottom" data-role-col={r.name}>
                  <span className="block font-semibold text-navy">{r.name}</span>
                  <span className="block text-xs font-normal text-ink-2">{r.people} {r.people === 1 ? "person" : "people"}{r.active ? "" : " · inactive"}</span>
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key}>
              <tr>
                <th scope="colgroup" colSpan={cols.length + 1} className="sticky left-0 bg-fill px-3 py-1.5 text-left text-[13px] font-bold uppercase tracking-wide text-ink-2">{g.label}</th>
              </tr>
              {g.items.map((i) => (
                <tr key={i.key} className="hover:bg-fill/60">
                  <th scope="row" className="sticky left-0 z-10 border-b border-line bg-white px-3 py-1.5 text-left font-normal" title={i.help}>{i.label}</th>
                  {cols.map((r) => {
                    const on = ticks.get(r.id)!.has(i.key);
                    const changed = on !== initial.get(r.id)!.has(i.key);
                    return (
                      <td key={r.id} className={`border-b border-l border-line text-center ${changed ? "bg-act-bg" : ""}`}>
                        <input
                          type="checkbox" checked={on} disabled={!editable} onChange={(e) => toggle(r.id, i.key, e.target.checked)}
                          aria-label={`${r.name}: ${i.label}`} data-tick={`${r.name}|${i.key}`}
                          className="h-5 w-5 accent-[var(--navy)]"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {editable && (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="matrix" value={JSON.stringify(diff.map((d) => ({ roleId: d.role.id, permissions: [...ticks.get(d.role.id)!] })))} />
          {reviewing && diff.length > 0 && (
            <div className="rounded-xl border border-act-line bg-act-bg p-3 text-sm" data-matrix-review>
              <p className="font-semibold">Check the changes, then save:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {diff.map((d) => (
                  <li key={d.role.id}>
                    <span className="font-semibold">{d.role.name}</span> ({d.role.people} {d.role.people === 1 ? "person" : "people"}):
                    {d.added.length > 0 && <> adds {d.added.map((k) => label.get(k) ?? k).join(", ")}.</>}
                    {d.removed.length > 0 && <> removes {d.removed.map((k) => label.get(k) ?? k).join(", ")}.</>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {!reviewing
              ? <button type="button" className="btn-secondary" disabled={!diff.length} onClick={() => setReviewing(true)}>Review changes{diff.length ? ` (${diff.length} role${diff.length === 1 ? "" : "s"})` : ""}</button>
              : <SubmitButton className="btn-primary" disabled={!diff.length}>Save the matrix</SubmitButton>}
            {reviewing && <button type="button" className="btn-ghost" onClick={() => setReviewing(false)}>Keep editing</button>}
            <button type="button" className="btn-ghost" disabled={!diff.length} onClick={() => { setTicks(initial); setReviewing(false); }}>Undo all</button>
            {state && <FormMessage state={state} />}
          </div>
        </form>
      )}
    </div>
  );
}
