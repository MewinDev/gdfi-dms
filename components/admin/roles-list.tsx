"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { roleCommandAction } from "@/app/actions/admin";
import { SearchIcon } from "@/components/ui/icons";
import { SAVED_EVENT } from "./settings-modal";
import type { StatusFilter } from "./settings-list";

export interface RoleRow {
  id: string;
  name: string;
  builtIn: boolean;
  active: boolean;
  people: number;
  on: number;
  total: number;
  editHref: string;
  /** "Last changed Nov 9, 2026 by Admin: added Refresh a loan from MyLoans", or null. */
  lastChange: string | null;
}

/** Roles list: search, Active / Inactive / All, Add role, Download access matrix, Duplicate and Edit per row. */
export function RolesList({ rows, addHref, editHrefBase }: { rows: RoleRow[]; addHref: string; editHrefBase: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof roleCommandAction>>, fd: FormData) => {
    const r = await roleCommandAction(prev, fd);
    if (r?.ok) {
      window.dispatchEvent(new Event(SAVED_EVENT));
      if (r.roleId) router.push(`${editHrefBase}${r.roleId}`, { scroll: false });
    }
    return r;
  }, null);
  const needle = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => (status === "all" ? true : status === "active" ? r.active : !r.active))
    .filter((r) => !needle || r.name.toLowerCase().includes(needle));
  const inactive = rows.filter((r) => !r.active).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex h-[46px] min-w-0 shrink-0 items-center gap-2.5 rounded-xl border border-line-input bg-fill-soft px-4 focus-within:border-navy focus-within:bg-white sm:flex-1">
          <span className="text-ink-2"><SearchIcon size={18} /></span>
          <label htmlFor="settings-filter" className="sr-only">Find a role</label>
          <input id="settings-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a role" autoComplete="off" className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none focus-visible:outline-none" />
        </div>
        <div>
          <label htmlFor="settings-status" className="sr-only">Show</label>
          <select id="settings-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="input h-[46px] sm:w-40">
            <option value="active">Active</option>
            <option value="inactive">Inactive{inactive ? ` (${inactive})` : ""}</option>
            <option value="all">All</option>
          </select>
        </div>
        <Link href={addHref} scroll={false} className="btn-gold shrink-0">Add role</Link>
      </div>
      <a href="/api/settings/roles-matrix" download="gdfi-dms-access-matrix.csv" className="link self-start text-sm">Download access matrix</a>
      <p className="text-xs text-ink-2" role="status" aria-live="polite">{shown.length} of {rows.length}</p>
      {state && !state.ok && <p role="alert" className="text-sm text-bad-fg">{state.error}</p>}
      <ul className="divide-y divide-[rgb(12_35_64/0.1)] rounded-xl border border-line">
        {shown.map((r) => (
          <li key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap ${r.active ? "" : "bg-fill-soft"}`} data-role-card={r.name}>
            <div className="min-w-0 flex-1">
              <p className={`flex flex-wrap items-center gap-2 text-[15px] font-semibold ${r.active ? "text-navy" : "text-ink-2"}`}>
                {r.name}
                <span className={`chip h-6 text-xs ${r.builtIn ? "c-navy" : "c-act"}`}>{r.builtIn ? "Built-in" : "Custom"}</span>
                {!r.active && <span className="chip c-mute h-6 text-xs">Inactive</span>}
              </p>
              <p className="text-sm text-ink-2">
                {r.people} {r.people === 1 ? "person" : "people"} · {r.on} of {r.total} permissions ticked
              </p>
              {r.lastChange && <p className="text-xs text-ink-2" data-last-change>{r.lastChange}</p>}
            </div>
            <form action={action}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="cmd" value="duplicate" />
              <button type="submit" disabled={pending} className="btn-ghost btn-sm" aria-label={`Duplicate ${r.name}`}>Duplicate</button>
            </form>
            <Link href={r.editHref} scroll={false} className="btn-ghost btn-sm shrink-0" aria-label={`Edit ${r.name}`}>Edit</Link>
          </li>
        ))}
        {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-2">Nothing matches.</li>}
      </ul>
    </div>
  );
}
