import Link from "next/link";
import { prisma } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getSetting } from "@/lib/settings";
import { fmtShort } from "@/lib/time";
import { getMyLoansAdapter } from "@/lib/myloans";
import { branchWorkload, recentBranchRuns, reviewRows, openReviewCount } from "@/lib/services/branches";
import { inactiveEffect } from "@/lib/services/settings-status";
import { SettingsModal } from "@/components/admin/settings-modal";
import { SettingsEditForm, type FieldDef } from "@/components/admin/forms";
import { StatusPanel } from "@/components/admin/status-panel";
import { ImportStep } from "@/components/admin/import-step";
import { SearchIcon } from "@/components/ui/icons";
import { BranchScheduleForm, BranchSyncButton, HidePanel, MyLoansImport, ReviewItem } from "./client";

/**
 * Settings, Branches. Steps in the same window (the URL is the source of truth):
 *   list (default)      code, name, area, division, status, source, last sync; filters; "Code needed" first
 *   edit=<id> | new     the form (read-only MyLoans fields), status, Hide from DMS
 *   step=myloans        Import from MyLoans (preview, confirm)
 *   step=review         the Branch review (open, then decided)
 *   step=sync           Branches from MyLoans (API), the daily schedule, the last runs
 *   step=import         the usual Import / Export of the list
 */
const BASE = "/admin/settings";
const href = (q: Record<string, string | undefined>) => `${BASE}?${new URLSearchParams(Object.entries({ open: "branches", ...q }).filter(([, v]) => !!v) as [string, string][]).toString()}`;

export interface BranchFilter { q?: string; area?: string; source?: string; show?: string }

type Common = { id: string; title: string; help: string; closeHref: string; returnFocusId: string };

export async function BranchesModal({ common, edit, step, user, filter }: { common: Common; edit?: string; step?: string; user: CurrentUser; filter: BranchFilter }) {
  const manage = can(user, PERMISSIONS.SOURCE_MANAGE);
  const back = href({});
  if (step === "import" && can(user, PERMISSIONS.SETTINGS_IMPORT)) {
    return (
      <SettingsModal {...common} title="Branches: Import / Export" help="Download a file, fill it in Excel, then check and import it. Branches from MyLoans change only through Import from MyLoans." backHref={back} footer={{ kind: "done" }}>
        <ImportStep list="branches" />
      </SettingsModal>
    );
  }
  if (step === "myloans" && manage) {
    return (
      <SettingsModal {...common} title="Branches: Import from MyLoans" help="MyLoans is the source of truth for branch codes, names, areas, divisions and status. Check the file first; nothing is saved until you confirm." backHref={back} footer={{ kind: "done" }}>
        <MyLoansImport />
      </SettingsModal>
    );
  }
  if (step === "review" && manage) {
    return <SettingsModal {...common} title="Branches: Branch review" help="Differences between MyLoans and the DMS. Accept applies one (after showing who gains or loses access); Ignore leaves the DMS as it is. Nothing is deleted." backHref={back} footer={{ kind: "done" }}><ReviewStep /></SettingsModal>;
  }
  if (step === "sync" && manage) {
    return <SettingsModal {...common} title="Branches: from MyLoans" help="The branch list through the MyLoans API: now, or once a day. Differences go to the Branch review." backHref={back} footer={{ kind: "done" }}><SyncStep /></SettingsModal>;
  }
  if (edit) return <EditStep common={common} id={edit === "new" ? null : edit} user={user} back={back} />;
  return (
    <SettingsModal {...common} footer={{ kind: "done" }} headerLink={can(user, PERMISSIONS.SETTINGS_IMPORT) ? { href: href({ step: "import" }), label: "Import / Export" } : undefined}>
      <ListStep filter={filter} manage={manage} />
    </SettingsModal>
  );
}

async function ListStep({ filter, manage }: { filter: BranchFilter; manage: boolean }) {
  const [rows, areas, openReview] = await Promise.all([
    prisma.branch.findMany({ include: { area: true, division: true, usualLtoOffice: true } }),
    prisma.area.findMany({ orderBy: { name: "asc" } }),
    openReviewCount(),
  ]);
  const q = (filter.q ?? "").trim().toLowerCase();
  const show = filter.show ?? "active";
  const shown = rows
    .filter((b) => (show === "all" ? true : show === "inactive" ? !b.active : show === "hidden" ? b.hidden : b.active))
    .filter((b) => !filter.area || (filter.area === "none" ? !b.areaId : b.areaId === filter.area))
    .filter((b) => !filter.source || b.source === filter.source)
    .filter((b) => !q || (b.code ?? "").includes(q) || b.name.toLowerCase().includes(q))
    // "Code needed" first, then "Area needed", then by code.
    .sort((a, b) => Number(!!a.code) - Number(!!b.code) || Number(!!a.areaId) - Number(!!b.areaId) || (a.code ?? "").localeCompare(b.code ?? "") || a.name.localeCompare(b.name));
  const work = new Map(await Promise.all(shown.filter((b) => !b.active).slice(0, 50).map(async (b) => [b.id, await branchWorkload(b.id)] as const)));
  const needCode = rows.filter((b) => !b.code).length;
  const needArea = rows.filter((b) => !b.areaId).length;
  return (
    <div className="flex flex-col gap-4" data-branches-list>
      {manage && (
        <nav aria-label="Branches from MyLoans" className="flex flex-wrap gap-2">
          <Link href={href({ step: "review" })} scroll={false} className={openReview ? "btn-gold" : "btn-ghost"} data-review-link>Branch review{openReview ? ` (${openReview})` : ""}</Link>
          <Link href={href({ step: "myloans" })} scroll={false} className="btn-ghost">Import from MyLoans</Link>
          <Link href={href({ step: "sync" })} scroll={false} className="btn-ghost">Branches from MyLoans</Link>
          <Link href={href({ edit: "new" })} scroll={false} className="btn-ghost sm:ml-auto">Add branch (not in MyLoans)</Link>
        </nav>
      )}
      {(needCode > 0 || needArea > 0) && (
        <p className="rounded-xl bg-act-bg px-4 py-2.5 text-sm font-semibold text-act-fg" data-needs-note>
          {[needCode && `${needCode} branch${needCode === 1 ? "" : "es"} need${needCode === 1 ? "s" : ""} a code`, needArea && `${needArea} need${needArea === 1 ? "s" : ""} an area`].filter(Boolean).join("; ")}. Codes are never guessed: import the MyLoans list or type the code.
        </p>
      )}
      <form method="get" action={BASE} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" aria-label="Filter branches">
        <input type="hidden" name="open" value="branches" />
        <div className="flex h-[46px] min-w-0 items-center gap-2.5 rounded-xl border border-line-input bg-fill-soft px-4 focus-within:border-navy focus-within:bg-white sm:flex-1">
          <span className="text-ink-2"><SearchIcon size={18} /></span>
          <label htmlFor="br-q" className="sr-only">Find a branch by code or name</label>
          <input id="br-q" name="q" defaultValue={filter.q ?? ""} placeholder="Find by code or name" autoComplete="off" className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
        </div>
        <div><label htmlFor="br-area" className="label">Area</label>
          <select id="br-area" name="area" defaultValue={filter.area ?? ""} className="input h-[46px] sm:w-56">
            <option value="">All areas</option><option value="none">Area needed</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></div>
        <div><label htmlFor="br-show" className="label">Status</label>
          <select id="br-show" name="show" defaultValue={show} className="input h-[46px] sm:w-36">
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="hidden">Hidden</option><option value="all">All</option>
          </select></div>
        <div><label htmlFor="br-source" className="label">Source</label>
          <select id="br-source" name="source" defaultValue={filter.source ?? ""} className="input h-[46px] sm:w-36">
            <option value="">Any</option><option value="MYLOANS">MyLoans</option><option value="DMS">Made in the DMS</option>
          </select></div>
        <button type="submit" className="btn-secondary h-[46px]">Show</button>
      </form>
      <p className="text-xs text-ink-2" role="status">{shown.length} of {rows.length}</p>
      <ul className="divide-y divide-[rgb(12_35_64/0.1)] rounded-xl border border-line">
        {shown.slice(0, 400).map((b) => {
          const w = work.get(b.id);
          const title = `${b.name} (${b.code ?? "code needed"})`;
          return (
            <li key={b.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap ${b.active ? "" : "bg-fill-soft"}`} data-branch-row={b.code ?? b.name}>
              <div className="min-w-0 flex-1">
                <p className={`text-[15px] font-semibold ${b.active ? "text-navy" : "text-ink-2"}`}>
                  {b.code ? <span className="mono">{b.code}</span> : null} {b.name}
                </p>
                <p className="text-sm text-ink-2">
                  {b.area?.name ?? "No area"} · {b.division?.name ?? "No division"} · {b.source === "MYLOANS" ? "From MyLoans" : "Made in the DMS"}
                  {b.lastSyncedAt ? ` · last sync ${fmtShort(b.lastSyncedAt)}` : ""}
                  {b.usualLtoOffice ? ` · usual LTO: ${b.usualLtoOffice.name}` : ""}
                </p>
                {w && (w.activeUsers > 0 || w.openLoans > 0) && <p className="mt-0.5 text-sm font-medium text-act-fg" data-inactive-warning>Inactive, but still {w.activeUsers} active user{w.activeUsers === 1 ? "" : "s"} and {w.openLoans} open loan file{w.openLoans === 1 ? "" : "s"}.</p>}
                {b.note && <p className="mt-0.5 text-sm text-ink-2">{b.note}</p>}
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {!b.code && <span className="chip c-act h-6 text-xs">Code needed</span>}
                  {!b.areaId && <span className="chip c-act h-6 text-xs">Area needed</span>}
                  {!b.active && <span className="chip c-mute h-6 text-xs">Inactive</span>}
                  {b.hidden && <span className="chip c-mute h-6 text-xs">Hidden</span>}
                </span>
              </div>
              <Link href={href({ edit: b.id })} scroll={false} className="btn-ghost btn-sm shrink-0" aria-label={`Edit ${title}`}>Edit</Link>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-2">Nothing matches.</li>}
        {shown.length > 400 && <li className="px-4 py-3 text-sm text-ink-2">{shown.length - 400} more: narrow the search.</li>}
      </ul>
    </div>
  );
}

async function EditStep({ common, id, user, back }: { common: Common; id: string | null; user: CurrentUser; back: string }) {
  const [b, divisions, areas, offices] = await Promise.all([
    id ? prisma.branch.findUnique({ where: { id } }) : null,
    prisma.division.findMany({ orderBy: { name: "asc" } }),
    prisma.area.findMany({ orderBy: { name: "asc" } }),
    prisma.ltoOffice.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (id && !b) return <SettingsModal {...common} backHref={back} footer={{ kind: "done" }}><p>Branch not found.</p></SettingsModal>;
  const ro = b?.source === "MYLOANS";
  const fromMl = ro ? "From MyLoans: changes only there (Branch review)." : undefined;
  const fields: FieldDef[] = [
    { name: "code", label: "Branch code (3 digits)", type: "text", value: b?.code ?? "", width: "sm", readOnly: ro, help: fromMl ?? (b && !b.code ? "Code needed: type the MyLoans code when you know it. It is never guessed." : "As in MyLoans, 100 to 999.") },
    { name: "name", label: "Name", type: "text", value: b?.name, width: "lg", readOnly: ro, help: fromMl },
    { name: "divisionId", label: "Division", type: "select", value: b?.divisionId ?? "", readOnly: ro, options: [["", "None"], ...divisions.map((d) => [d.id, d.name] as [string, string])] },
    { name: "areaId", label: "Area", type: "select", value: b?.areaId ?? "", readOnly: ro, options: [["", "None (Area needed)"], ...areas.map((a) => [a.id, a.name] as [string, string])] },
    { name: "address", label: "Address (optional)", type: "text", value: b?.address ?? "", width: "lg", readOnly: ro },
    {
      name: "usualLtoOfficeId", label: "Usual LTO office (optional)", type: "select", value: b?.usualLtoOfficeId ?? "", width: "lg",
      options: [["", "None"], ...offices.filter((o) => o.active || o.id === b?.usualLtoOfficeId).map((o) => [o.id, `${o.name}${o.active ? "" : " · Inactive"}`] as [string, string])],
      help: "The DMS's own field. Pre-selected when sending a transaction that needs LTO processing; the Loan Associate can change it.",
    },
  ];
  const work = b && !b.active ? await branchWorkload(b.id) : null;
  return (
    <SettingsModal {...common} title={b ? `Branches: ${b.name}` : "Branches: Add branch"} backHref={back} footer={{ kind: "save", formId: "settings-form", cancelHref: back }}>
      {ro && <p className="mb-4 rounded-xl bg-fill px-4 py-2.5 text-sm" data-readonly-note>This branch comes from MyLoans: its code, name, division, area, address and status are read-only here. Only the usual LTO office is the DMS&apos;s own.{b?.lastSyncedAt ? ` Last sync ${fmtShort(b.lastSyncedAt)}.` : ""}</p>}
      <SettingsEditForm key={id ?? "new"} kind="branch" id={id} fields={fields} formId="settings-form" listHref={back} />
      {b && (
        <StatusPanel kind="branch" id={b.id} active={b.active} noun="branch" effect={await inactiveEffect("branch", b.id)}
          lockedReason={ro ? `${b.active ? "Active" : "Inactive"} in MyLoans. A branch from MyLoans is switched off or on there; the change reaches the Branch review.` : undefined} />
      )}
      {work && (work.activeUsers > 0 || work.openLoans > 0) && <p className="mt-2 text-sm font-medium text-act-fg" data-inactive-warning>Inactive, but still {work.activeUsers} active user{work.activeUsers === 1 ? "" : "s"} and {work.openLoans} open loan file{work.openLoans === 1 ? "" : "s"}. They stay; no new work can start here.</p>}
      {b && can(user, PERMISSIONS.SOURCE_MANAGE) && <HidePanel id={b.id} hidden={b.hidden} name={b.name} />}
    </SettingsModal>
  );
}

const SOURCE_WORD: Record<string, string> = { file: "file import", api: "MyLoans API", cron: "daily run", lookup: "seen in a lookup", seed: "built-in list" };

async function ReviewStep() {
  const [open, decided] = await Promise.all([reviewRows("OPEN"), reviewRows("DECIDED", 30)]);
  return (
    <div className="flex flex-col gap-5" data-branch-review>
      <section aria-labelledby="rv-open">
        <h3 id="rv-open" className="text-base font-bold text-navy">Waiting for a decision ({open.length})</h3>
        <ul className="mt-2 divide-y divide-[rgb(12_35_64/0.1)] rounded-xl border border-line">
          {open.map((r) => (
            <ReviewItem key={r.id} r={{ id: r.id, kind: r.kind, kindLabel: r.kindLabel, title: r.title, fields: r.fields, detected: fmtShort(r.detectedAt), source: SOURCE_WORD[r.source] ?? r.source, pn: r.pn, area: r.area, division: r.division, suggestHide: r.suggestHide, note: r.note, linkable: r.linkable }} />
          ))}
          {open.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-2">Nothing to review. The DMS matches the last MyLoans list.</li>}
        </ul>
      </section>
      <section aria-labelledby="rv-done">
        <h3 id="rv-done" className="text-base font-bold text-navy">Decided lately</h3>
        <ul className="mt-2 divide-y divide-[rgb(12_35_64/0.1)] rounded-xl border border-line text-sm" data-review-history>
          {decided.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <span className={`chip h-6 text-xs ${r.state === "ACCEPTED" ? "c-ok" : "c-mute"}`}>{r.state === "ACCEPTED" ? "Accepted" : "Ignored"}</span>
              <span className="min-w-0 flex-1">{r.kindLabel}: {r.title}{r.note ? ` (${r.note})` : ""}</span>
              <span className="text-xs text-ink-2">{r.decidedByLabel ?? "System"} · {r.decidedAt ? fmtShort(r.decidedAt) : ""}</span>
            </li>
          ))}
          {decided.length === 0 && <li className="px-4 py-4 text-center text-ink-2">Nothing yet.</li>}
        </ul>
      </section>
    </div>
  );
}

async function SyncStep() {
  const [s, runs] = await Promise.all([getSetting("branches.sync"), recentBranchRuns(10)]);
  const supported = !!getMyLoansAdapter().capabilities.branches;
  return (
    <div className="flex flex-col gap-5" data-branch-sync-step>
      <BranchSyncButton supported={supported} />
      <section aria-labelledby="bs-h" className="flex flex-col gap-2">
        <h3 id="bs-h" className="text-base font-bold text-navy">Daily run</h3>
        <p className="text-sm text-ink-2">Once a day at this time (Philippine time) through the scheduled job, never more often. Only branches changed since the last good run are read when MyLoans allows it; once a week the whole list is read to find branches that disappeared. A failed run changes nothing.</p>
        <BranchScheduleForm time={s.time} paused={s.paused} />
        <p className="text-sm text-ink-2">Last good run: {s.lastSuccessAt ? fmtShort(s.lastSuccessAt) : "never"} · last full read: {s.lastFullAt ? fmtShort(s.lastFullAt) : "never"}.</p>
      </section>
      <section aria-labelledby="bs-runs">
        <h3 id="bs-runs" className="text-base font-bold text-navy">Last runs</h3>
        <div className="mt-2 overflow-x-auto rounded-xl border border-line">
          <table className="table text-sm" data-branch-runs>
            <thead><tr><th scope="col">When</th><th scope="col">How</th><th scope="col">Mode</th><th scope="col">New</th><th scope="col">Changed</th><th scope="col">Unchanged</th><th scope="col">Missing</th><th scope="col">Errors</th><th scope="col">Result</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtShort(r.at)}</td>
                  <td>{SOURCE_WORD[r.trigger] ?? r.trigger}{r.fileName ? ` (${r.fileName})` : ""} · {r.byLabel}</td>
                  <td>{r.mode === "FULL" ? "Full" : r.mode === "INCREMENTAL" ? "Changed since last" : "File"}</td>
                  <td>{r.newCount}</td><td>{r.changedCount}</td><td>{r.unchangedCount}</td><td>{r.missingCount}</td><td>{r.errorCount}</td>
                  <td className={r.ok ? "" : "text-bad-fg"}>{r.ok ? `OK, ${r.ms} ms` : r.error ?? "Failed"}</td>
                </tr>
              ))}
              {runs.length === 0 && <tr><td colSpan={9} className="text-center text-ink-2">No runs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
