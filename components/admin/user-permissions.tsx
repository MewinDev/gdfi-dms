"use client";

import { useActionState, useMemo, useState } from "react";
import { saveUserOverridesAction } from "@/app/actions/admin";
import { FormMessage, SubmitButton } from "@/components/form-status";

/**
 * Users, Edit, Permissions (D-008): every permission as Inherited (from the role), Granted or Denied for
 * this person, with a short reason for each override, and the "Can approve LA Open Items" tick (D-010).
 * Only someone who can manage permissions changes it, and never for themselves (checked again on the
 * server, lib/services/user-rights.ts). Saving sends only what changed.
 */
export type OverrideValue = "INHERIT" | "GRANT" | "DENY";
export interface PermissionRow { key: string; label: string; help: string; inRole: boolean; effective: boolean; value: OverrideValue; note: string }
export interface PermissionGroupRows { key: string; label: string; rows: PermissionRow[] }

export function UserPermissionsPanel({ userId, userName, groups, approver, editable, readOnlyReason, fundTypeNote }: {
  userId: string;
  userName: string;
  groups: PermissionGroupRows[];
  approver: { keys: string[]; on: boolean; source: "INHERITED" | "GRANTED" | "DENIED" | "NONE" };
  editable: boolean;
  readOnlyReason?: string;
  /** "Funds keys count only for the types ticked above" when the person handles neither or one type. */
  fundTypeNote?: string;
}) {
  const initial = useMemo(() => new Map(groups.flatMap((g) => g.rows).map((r) => [r.key, { value: r.value, note: r.note }])), [groups]);
  const [values, setValues] = useState(initial);
  const [filter, setFilter] = useState<"all" | "overrides">("overrides");
  const [state, action] = useActionState(saveUserOverridesAction, null);
  const changed = [...values.entries()].filter(([k, v]) => v.value !== initial.get(k)?.value || v.note !== initial.get(k)?.note);
  const set = (key: string, patch: Partial<{ value: OverrideValue; note: string }>) =>
    setValues((m) => new Map(m).set(key, { ...m.get(key)!, ...patch }));
  const approverValue: OverrideValue = approver.keys.every((k) => values.get(k)?.value === "GRANT") ? "GRANT" : approver.keys.some((k) => values.get(k)?.value === "DENY") ? "DENY" : "INHERIT";
  const setApprover = (v: OverrideValue) => approver.keys.forEach((k) => set(k, { value: v }));
  const overrideCount = [...values.values()].filter((v) => v.value !== "INHERIT").length;

  return (
    <section className="mt-6 flex flex-col gap-3 border-t border-line pt-5" aria-labelledby={`perm-h-${userId}`} data-user-permissions>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`perm-h-${userId}`} className="text-[17px] font-bold text-navy">Permissions</h3>
        <span className="text-sm text-ink-2">{overrideCount ? `${overrideCount} override${overrideCount === 1 ? "" : "s"}` : "Same as the role"}</span>
      </div>
      <p className="help">Inherited = what the role gives. Granted or Denied changes it for {userName} only; Denied always wins. Every change is in the audit log.</p>
      {!editable && <p className="rounded-xl bg-fill px-3 py-2 text-sm" data-permissions-readonly>{readOnlyReason ?? "Read only."}</p>}
      {fundTypeNote && <p className="rounded-xl bg-fill px-3 py-2 text-sm">{fundTypeNote}</p>}

      <form
        action={action}
        className="flex flex-col gap-3"
        onSubmit={(e) => { if (!changed.length) e.preventDefault(); }}
      >
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="overrides" value={JSON.stringify(changed.map(([key, v]) => ({ key, value: v.value, note: v.note })))} />

        <fieldset className="rounded-xl border border-line p-3" disabled={!editable}>
          <legend className="px-1 text-[15px] font-semibold">Can approve LA Open Items</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1" role="radiogroup" aria-label="Can approve LA Open Items">
            {([["INHERIT", `Role default (${approverRoleDefault(groups, approver.keys) ? "yes" : "no"})`], ["GRANT", "Yes"], ["DENY", "No"]] as const).map(([v, label]) => (
              <label key={v} className="inline-flex min-h-11 items-center gap-2 text-[15px]">
                <input type="radio" name="approver" checked={approverValue === v} onChange={() => setApprover(v)} className="h-5 w-5 accent-[var(--navy)]" />
                {label}
              </label>
            ))}
          </div>
          {approverValue !== "INHERIT" && (
            <input aria-label="Why (approver)" placeholder="Why (required)" className="input mt-2" maxLength={200}
              value={values.get(approver.keys[0])?.note ?? ""} onChange={(e) => approver.keys.forEach((k) => set(k, { note: e.target.value }))} />
          )}
          <p className="help">Approves or rejects myloans changes (Open Items) for the branches in {userName}&rsquo;s access.</p>
        </fieldset>

        <div className="flex flex-wrap gap-x-5" role="radiogroup" aria-label="Show">
          {([["overrides", "Overrides only"], ["all", "All permissions"]] as const).map(([v, label]) => (
            <label key={v} className="inline-flex min-h-11 items-center gap-2 text-[15px]">
              <input type="radio" name="show" checked={filter === v} onChange={() => setFilter(v)} className="h-5 w-5 accent-[var(--navy)]" />
              {label}
            </label>
          ))}
        </div>

        {groups.map((g) => {
          const rows = g.rows.filter((r) => !approver.keys.includes(r.key) && (filter === "all" || values.get(r.key)!.value !== "INHERIT" || initial.get(r.key)!.value !== "INHERIT"));
          if (!rows.length) return null;
          return (
            <fieldset key={g.key} className="rounded-xl border border-line p-3" disabled={!editable}>
              <legend className="px-1 text-[15px] font-semibold">{g.label}</legend>
              <ul className="flex flex-col divide-y divide-line">
                {rows.map((r) => {
                  const v = values.get(r.key)!;
                  return (
                    <li key={r.key} className="flex flex-col gap-1.5 py-2" data-perm={r.key}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[15px]" title={r.help}>
                          {r.label}
                          <span className={`chip ml-2 h-6 text-xs ${r.effective ? "c-ok" : "c-mute"}`}>{r.effective ? "Has it" : "Not"}</span>
                        </span>
                        <select aria-label={`${r.label}: inherited, granted or denied`} className="input w-auto min-w-44" value={v.value} onChange={(e) => set(r.key, { value: e.target.value as OverrideValue })}>
                          <option value="INHERIT">Inherited ({r.inRole ? "role has it" : "role does not"})</option>
                          <option value="GRANT">Granted</option>
                          <option value="DENY">Denied</option>
                        </select>
                      </div>
                      {v.value !== "INHERIT" && (
                        <input aria-label={`Why: ${r.label}`} placeholder="Why (required)" className="input" maxLength={200} value={v.note} onChange={(e) => set(r.key, { note: e.target.value })} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
        {filter === "overrides" && overrideCount === 0 && <p className="text-sm text-ink-2">No overrides: {userName} has exactly what the role gives. Show all permissions to add one.</p>}

        {editable && (
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton className="btn-secondary" disabled={!changed.length}>Save permissions{changed.length ? ` (${changed.length})` : ""}</SubmitButton>
            {state && <FormMessage state={state} />}
          </div>
        )}
      </form>
    </section>
  );
}

const approverRoleDefault = (groups: PermissionGroupRows[], keys: string[]) => keys.every((k) => groups.flatMap((g) => g.rows).find((r) => r.key === k)?.inRole);
