"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SearchIcon } from "@/components/ui/icons";
import { setActiveAction } from "@/app/actions/admin";

export interface ListRow {
  id: string;
  title: string;
  sub: string;
  tags?: { text: string; tone: "act" | "mute" | "ok" | "navy" }[];
  href: string;
  /** Inactive rows: grey, "Inactive" chip, Make active button. */
  inactive?: boolean;
  /** A short hint under the row, e.g. "No papers set yet. Add them in Checklist items." */
  hint?: string;
}

export type StatusFilter = "active" | "inactive" | "all";

const TONE = { act: "c-act", mute: "c-mute", ok: "c-ok", navy: "c-navy" } as const;

function MakeActive({ kind, id, title }: { kind: string; id: string; title: string }) {
  const [state, action, pending] = useActionState(setActiveAction, null);
  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value="true" />
      <button type="submit" disabled={pending} className="btn-ghost btn-sm" aria-label={`Make ${title} active`}>{pending ? "Saving..." : "Make active"}</button>
      {state && !state.ok && <p role="alert" className="mt-1 text-xs text-bad-fg">{state.error}</p>}
    </form>
  );
}

/**
 * First step of a settings modal: a list with "Edit" on each row, a filter box, an
 * Active / Inactive / All filter (default Active) and an Add button. Editing opens the form in
 * the same modal (second step). Nothing is deleted: inactive rows show a Make active button.
 */
export function SettingsList({
  rows, addHref, addLabel, filterLabel, intro, statusKind,
}: {
  rows: ListRow[];
  addHref?: string;
  addLabel?: string;
  filterLabel?: string;
  intro?: string;
  /** Set for lists that can be made inactive: shows the status filter and Make active. */
  statusKind?: string;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const needle = q.trim().toLowerCase();
  const byStatus = statusKind ? rows.filter((r) => (status === "all" ? true : status === "active" ? !r.inactive : !!r.inactive)) : rows;
  const shown = needle ? byStatus.filter((r) => `${r.title} ${r.sub} ${(r.tags ?? []).map((t) => t.text).join(" ")}`.toLowerCase().includes(needle)) : byStatus;
  const inactiveCount = rows.filter((r) => r.inactive).length;
  return (
    <div className="flex flex-col gap-4">
      {intro && <p className="text-sm text-ink-2">{intro}</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {filterLabel && (
          <div className="flex h-[46px] min-w-0 shrink-0 items-center gap-2.5 rounded-xl border border-line-input bg-fill-soft px-4 focus-within:border-navy focus-within:bg-white sm:flex-1">
            <span className="text-ink-2"><SearchIcon size={18} /></span>
            <label htmlFor="settings-filter" className="sr-only">{filterLabel}</label>
            <input id="settings-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder={filterLabel} autoComplete="off"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-2 focus-visible:outline-none" />
          </div>
        )}
        {statusKind && (
          <div>
            <label htmlFor="settings-status" className="sr-only">Show</label>
            <select id="settings-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="input h-[46px] sm:w-40">
              <option value="active">Active</option>
              <option value="inactive">Inactive{inactiveCount ? ` (${inactiveCount})` : ""}</option>
              <option value="all">All</option>
            </select>
          </div>
        )}
        {addHref && <Link href={addHref} scroll={false} className="btn-gold shrink-0 sm:ml-auto">{addLabel ?? "Add"}</Link>}
      </div>
      <p className="text-xs text-ink-2" role="status" aria-live="polite">{shown.length} of {rows.length}</p>
      <ul className="divide-y divide-[rgb(12_35_64/0.1)] rounded-xl border border-line">
        {shown.map((r) => {
          const tags = [...(r.inactive ? [{ text: "Inactive", tone: "mute" as const }] : []), ...(r.tags ?? [])];
          return (
            <li key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap ${r.inactive ? "bg-fill-soft" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className={`text-[15px] font-semibold sm:truncate ${r.inactive ? "text-ink-2" : "text-navy"}`}>{r.title}</p>
                <p className="text-sm text-ink-2 sm:truncate">{r.sub}</p>
                {r.hint && <p className="mt-0.5 text-sm font-medium text-act-fg">{r.hint}</p>}
                {/* Phone: tags under the name */}
                {tags.length > 0 && (
                  <span className="mt-1.5 flex flex-wrap gap-1.5 sm:hidden">
                    {tags.map((t) => <span key={t.text} className={`chip h-6 text-xs ${TONE[t.tone]}`}>{t.text}</span>)}
                  </span>
                )}
              </div>
              <span className="hidden flex-wrap justify-end gap-1.5 sm:flex">
                {tags.map((t) => <span key={t.text} className={`chip h-6 text-xs ${TONE[t.tone]}`}>{t.text}</span>)}
              </span>
              {r.inactive && statusKind && <MakeActive kind={statusKind} id={r.id} title={r.title} />}
              <Link href={r.href} scroll={false} className="btn-ghost btn-sm shrink-0" aria-label={`Edit ${r.title}`}>Edit</Link>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-ink-2">
            {statusKind && status === "inactive" && !needle ? "Nothing is inactive." : "Nothing matches."}
          </li>
        )}
      </ul>
    </div>
  );
}
