"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { accessSummary, coveredByGroup, effectiveBranchIds, normalizeGrants, type BranchPlace, type GrantLike } from "@/lib/branches/access";

/**
 * Users, Edit, Branch access: where the person works (roles say what they can do). All branches, or
 * Selected: a tree Division > Area > Branch with three-state boxes. Ticking a Division or an Area grants
 * it as a whole (branches added to it later are included); unticking one branch inside a ticked Area
 * makes an exception. Grants and exceptions are sent as JSON in the hidden field "access".
 */

export interface AccessTreeBranch { id: string; name: string; code: string | null; active: boolean }
export interface AccessTreeArea { id: string | null; name: string; branches: AccessTreeBranch[] }
export interface AccessTreeDivision { id: string | null; name: string; areas: AccessTreeArea[] }
export interface AccessValue { all: boolean; grants: GrantLike[]; homeBranchId: string | null }
export interface AccessOtherUser extends AccessValue { id: string; name: string }

const branchWord = (n: number) => `${n} branch${n === 1 ? "" : "es"}`;
const label = (b: { name: string; code: string | null }) => b.name;

function Tri({ id, state, disabled, onChange, labelText, describedBy }: { id: string; state: "all" | "some" | "none"; disabled?: boolean; onChange: () => void; labelText: string; describedBy?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === "some"; }, [state]);
  return (
    <input
      ref={ref} id={id} type="checkbox" checked={state === "all"} disabled={disabled} onChange={onChange}
      aria-checked={state === "some" ? "mixed" : state === "all"} aria-label={labelText} aria-describedby={describedBy}
      data-state={state} className="h-5 w-5 shrink-0 accent-[var(--navy)]"
    />
  );
}

export function BranchAccessField({
  tree, hiddenPlaces, initial, others, adminRoleIds, roleSelectId, error, homeError, allByDefaultRoleIds,
}: {
  /** New user only: roles whose default is All branches (the choice follows the role picked). */
  allByDefaultRoleIds?: string[];
  tree: AccessTreeDivision[];
  /** Hidden branches (not shown), so grants already on them are kept. */
  hiddenPlaces: BranchPlace[];
  initial: AccessValue;
  others: AccessOtherUser[];
  /** Roles that are always All branches (Admin). */
  adminRoleIds: string[];
  /** The role picker of the same form (to say "Admin is always All branches"). */
  roleSelectId: string;
  error?: string;
  homeError?: string;
}) {
  const uid = useId();
  const [all, setAll] = useState(initial.all);
  const [grants, setGrants] = useState<GrantLike[]>(initial.grants);
  const [home, setHome] = useState<string | null>(initial.homeBranchId);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const sel = document.getElementById(roleSelectId) as HTMLSelectElement | null;
    if (!sel) return;
    const first = { done: false };
    const sync = () => {
      setIsAdmin(adminRoleIds.includes(sel.value));
      // A new user starts with the default of the role picked (not on the first render: `initial` already has it).
      if (allByDefaultRoleIds && first.done) setAll(allByDefaultRoleIds.includes(sel.value));
      first.done = true;
    };
    sync();
    sel.addEventListener("change", sync);
    return () => sel.removeEventListener("change", sync);
  }, [roleSelectId, adminRoleIds, allByDefaultRoleIds]);

  const branches = useMemo(() => tree.flatMap((d) => d.areas.flatMap((a) => a.branches.map((b) => ({ ...b, divisionId: d.id, areaId: a.id, divisionName: d.name, areaName: a.name })))), [tree]);
  const byId = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const places = useMemo<BranchPlace[]>(() => [...branches.map((b) => ({ id: b.id, divisionId: b.divisionId, areaId: b.areaId })), ...hiddenPlaces], [branches, hiddenPlaces]);
  const effective = useMemo(() => effectiveBranchIds(grants, places), [grants, places]);
  const visibleEffective = useMemo(() => branches.filter((b) => effective.has(b.id)), [branches, effective]);
  const summary = accessSummary(grants, effective.size, all || isAdmin);

  const set = (next: GrantLike[]) => setGrants(normalizeGrants(next, places));
  const inArea = (b: { divisionId: string | null; areaId: string | null }, d: string | null, a: string | null) => b.divisionId === d && b.areaId === a;
  const stateOf = (list: AccessTreeBranch[]): "all" | "some" | "none" => {
    const n = list.filter((b) => effective.has(b.id)).length;
    return n === 0 ? "none" : n === list.length ? "all" : "some";
  };
  const isGroupGrant = (g: GrantLike, d: string | null, a?: string | null) =>
    !g.exclude && ((g.kind === "DIVISION" && g.divisionId === d) || (a !== undefined && g.kind === "AREA" && g.areaId === a && (!g.divisionId || g.divisionId === d)));

  function toggleDivision(d: AccessTreeDivision) {
    const ids = new Set(d.areas.flatMap((a) => a.branches.map((b) => b.id)));
    const rest = grants.filter((g) => !(g.kind === "DIVISION" && g.divisionId === d.id) && !(g.kind === "AREA" && g.divisionId === d.id) && !(g.kind === "BRANCH" && ids.has(g.branchId!)));
    if (stateOf(d.areas.flatMap((a) => a.branches)) === "all") set(rest);
    else set(d.id ? [...rest, { kind: "DIVISION", divisionId: d.id, areaId: null, branchId: null, exclude: false }] : [...rest, ...[...ids].filter((id) => byId.get(id)?.active).map((id) => ({ kind: "BRANCH" as const, divisionId: null, areaId: null, branchId: id, exclude: false }))]);
  }

  function toggleArea(d: AccessTreeDivision, a: AccessTreeArea, forceOn = false) {
    const ids = new Set(a.branches.map((b) => b.id));
    let rest = grants.filter((g) => !(g.kind === "AREA" && g.areaId === a.id && g.divisionId === d.id) && !(g.kind === "BRANCH" && ids.has(g.branchId!)));
    const divisionGrant = grants.some((g) => isGroupGrant(g, d.id));
    if (!forceOn && stateOf(a.branches) === "all") {
      if (divisionGrant) {
        // The division stays ticked except this area: tick the division's other areas instead.
        rest = rest.filter((g) => !(g.kind === "DIVISION" && g.divisionId === d.id));
        for (const other of d.areas) if (other.id !== a.id && other.id) rest.push({ kind: "AREA", divisionId: d.id, areaId: other.id, branchId: null, exclude: false });
      }
      set(rest);
    } else {
      set(a.id && d.id ? [...rest, { kind: "AREA", divisionId: d.id, areaId: a.id, branchId: null, exclude: false }] : [...rest, ...a.branches.filter((b) => b.active).map((b) => ({ kind: "BRANCH" as const, divisionId: null, areaId: null, branchId: b.id, exclude: false }))]);
    }
  }

  function toggleBranch(b: AccessTreeBranch) {
    const place = byId.get(b.id)!;
    const on = effective.has(b.id);
    const rest = grants.filter((g) => !(g.kind === "BRANCH" && g.branchId === b.id));
    if (on) set(coveredByGroup(grants, place) ? [...rest, { kind: "BRANCH", divisionId: null, areaId: null, branchId: b.id, exclude: true }] : rest);
    else set(grants.some((g) => g.kind === "BRANCH" && g.branchId === b.id && g.exclude) ? rest : [...rest, { kind: "BRANCH", divisionId: null, areaId: null, branchId: b.id, exclude: false }]);
  }

  const q = query.trim().toLowerCase();
  const matches = (b: AccessTreeBranch) => !q || b.name.toLowerCase().includes(q) || (b.code ?? "").includes(q);
  const keyOf = (d: AccessTreeDivision, a?: AccessTreeArea) => `${d.id ?? "none"}|${a ? a.id ?? "none" : ""}`;
  const toggleOpen = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const exceptionsIn = (d: AccessTreeDivision, a?: AccessTreeArea) =>
    grants.filter((g) => g.kind === "BRANCH" && g.exclude && byId.has(g.branchId!) && (a ? inArea(byId.get(g.branchId!)!, d.id, a.id) : byId.get(g.branchId!)!.divisionId === d.id)).length;

  const homeOptions = (all || isAdmin ? branches : visibleEffective).filter((b) => (b.active || b.id === home));
  const homeValue = home && (all || isAdmin || effective.has(home)) ? home : "";
  const value: AccessValue = { all: all || isAdmin, grants: all || isAdmin ? [] : grants, homeBranchId: homeValue || null };

  function copy() {
    const o = others.find((x) => x.id === copyFrom);
    if (!o) return;
    setAll(o.all);
    const g = normalizeGrants(o.grants, places);
    setGrants(g);
    const eff = effectiveBranchIds(g, places);
    setHome(o.homeBranchId && (o.all || eff.has(o.homeBranchId)) ? o.homeBranchId : home && (o.all || eff.has(home)) ? home : null);
    setCopied(o.name);
  }

  return (
    <fieldset className="flex flex-col gap-3" data-branch-access>
      <legend className="label">Branch access</legend>
      <p className="help -mt-1">Where this person works. The role says what they can do; this says where. Every branch here is workable.</p>
      <input type="hidden" name="access" value={JSON.stringify(value)} />
      {isAdmin && <p className="rounded-xl bg-fill px-3 py-2 text-sm" data-admin-all>Admin always has All branches.</p>}

      <div className="flex flex-wrap gap-x-6 gap-y-1" role="radiogroup" aria-label="Branch access">
        <label className="inline-flex min-h-11 items-center gap-2.5 text-[15px]">
          <input type="radio" name={`${uid}-mode`} checked={all || isAdmin} disabled={isAdmin} onChange={() => setAll(true)} className="h-5 w-5 accent-[var(--navy)]" />
          All branches
        </label>
        <label className="inline-flex min-h-11 items-center gap-2.5 text-[15px]">
          <input type="radio" name={`${uid}-mode`} checked={!all && !isAdmin} disabled={isAdmin} onChange={() => setAll(false)} className="h-5 w-5 accent-[var(--navy)]" />
          Selected
        </label>
      </div>

      <p className="text-sm font-semibold text-navy" data-access-summary aria-live="polite">{summary}</p>

      {!all && !isAdmin && (
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor={`${uid}-q`} className="sr-only">Find a branch in the tree</label>
            <input id={`${uid}-q`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a branch by name or code" className="input" />
          </div>
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line" data-access-tree>
            {tree.map((d) => {
              const dBranches = d.areas.flatMap((a) => a.branches);
              const shown = dBranches.filter(matches);
              if (q && !shown.length) return null;
              const dk = keyOf(d);
              const dOpen = open.has(dk) || !!q;
              const dEx = grants.some((g) => isGroupGrant(g, d.id)) ? exceptionsIn(d) : 0;
              return (
                <li key={dk} data-division={d.name}>
                  <div className="flex min-h-12 items-center gap-2 px-3">
                    <Tri id={`${uid}-d-${dk}`} state={stateOf(dBranches)} onChange={() => toggleDivision(d)} labelText={`${d.name}: all branches`} />
                    <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={dOpen} onClick={() => toggleOpen(dk)}>
                      <span aria-hidden="true" className="text-ink-2">{dOpen ? "▾" : "▸"}</span>
                      <span className="min-w-0 font-bold text-navy">{d.name} <span className="font-normal text-ink-2">· {branchWord(dBranches.length)}</span></span>
                    </button>
                  </div>
                  {dEx > 0 && <p className="px-11 pb-2 text-sm text-ink-2" data-exception-note>Everything in this division except {branchWord(dEx)}</p>}
                  {dOpen && (
                    <ul className="flex flex-col pb-1 pl-5">
                      {d.areas.map((a) => {
                        const aShown = a.branches.filter(matches);
                        if (q && !aShown.length) return null;
                        const ak = keyOf(d, a);
                        const aOpen = open.has(ak) || !!q;
                        const st = stateOf(a.branches);
                        const aEx = grants.some((g) => isGroupGrant(g, d.id, a.id)) ? exceptionsIn(d, a) : 0;
                        return (
                          <li key={ak} data-node={`${d.name}|${a.name}`} className="border-t border-line first:border-t-0">
                            <div className="flex min-h-12 flex-wrap items-center gap-2 px-3">
                              <Tri id={`${uid}-a-${ak}`} state={st} onChange={() => toggleArea(d, a)} labelText={`${a.name} (${d.name}): all branches`} />
                              <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={aOpen} onClick={() => toggleOpen(ak)}>
                                <span aria-hidden="true" className="text-ink-2">{aOpen ? "▾" : "▸"}</span>
                                <span className="min-w-0 font-semibold">{a.name} <span className="font-normal text-ink-2">· {branchWord(a.branches.length)}</span></span>
                              </button>
                              {st !== "all" && a.id && <button type="button" className="btn-ghost btn-sm min-h-11" onClick={() => toggleArea(d, a, true)}>Select all in this area</button>}
                            </div>
                            {aEx > 0 && <p className="px-11 pb-2 text-sm text-ink-2" data-exception-note>Everything in this area except {branchWord(aEx)}</p>}
                            {aOpen && (
                              <ul className="flex flex-col pb-2 pl-9">
                                {aShown.map((b) => {
                                  const on = effective.has(b.id);
                                  const fid = `${uid}-b-${b.id}`;
                                  return (
                                    <li key={b.id} data-branch={b.code ?? b.name}>
                                      <label htmlFor={fid} className={`flex min-h-11 items-center gap-2.5 text-[15px] ${b.active ? "" : "text-ink-2"}`}>
                                        <input id={fid} type="checkbox" checked={on} disabled={!b.active && !on} onChange={() => toggleBranch(b)} className="h-5 w-5 shrink-0 accent-[var(--navy)]" />
                                        <span className="min-w-0">{label(b)}</span>
                                        {!b.active && <span className="chip c-mute h-6 text-xs">Inactive</span>}
                                      </label>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <details className="text-sm" data-effective-list>
            <summary className="link inline-flex min-h-11 cursor-pointer items-center">Show the {branchWord(visibleEffective.length)} in the access</summary>
            <ul className="mt-1 columns-1 gap-6 sm:columns-2">
              {visibleEffective.map((b) => <li key={b.id} className={b.active ? "" : "text-ink-2"}>{label(b)}{b.active ? "" : " · Inactive"}</li>)}
            </ul>
          </details>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-bad-fg" data-access-error>{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-home`} className="label">Home branch</label>
          <select id={`${uid}-home`} value={homeValue} onChange={(e) => setHome(e.target.value || null)} className="input" aria-invalid={!!homeError} data-home-branch>
            <option value="">{homeOptions.length ? "The first branch of the access" : "No branch yet"}</option>
            {homeOptions.map((b) => <option key={b.id} value={b.id}>{label(b)}{b.active ? "" : " · Inactive"}</option>)}
          </select>
          <p className="help">The default for new work and sending. Only branches in the access.</p>
          {homeError && <p className="mt-1.5 text-sm text-bad-fg">{homeError}</p>}
        </div>
        {others.length > 0 && (
          <div>
            <label htmlFor={`${uid}-copy`} className="label">Copy access from another user</label>
            <div className="flex gap-2">
              <select id={`${uid}-copy`} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="input min-w-0 flex-1">
                <option value="">Pick a user</option>
                {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button type="button" className="btn-secondary shrink-0" disabled={!copyFrom} onClick={copy}>Copy</button>
            </div>
            {copied && <p role="status" className="help">Copied the access of {copied}. Save to keep it.</p>}
          </div>
        )}
      </div>
    </fieldset>
  );
}
