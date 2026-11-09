"use client";

import { useState } from "react";
import { PRESETS, type Preset } from "@/lib/monitoring/rules";

/**
 * The filters at the top of Monitoring, kept in the URL (a GET form): dates (presets or Custom From and
 * To), branch, transaction type, and in the By day view one processor or office.
 */
export function FilterBar(p: {
  tab: "dp" | "lto";
  view: "totals" | "day";
  preset: Preset;
  from: string;
  to: string;
  today: string;
  branch: string;
  type: string;
  branches: { id: string; name: string }[];
  types: { code: string; name: string }[];
  /** By day: processors or offices to pick one of. */
  who: { name: "dp" | "office"; label: string; value: string; options: { id: string; name: string }[] } | null;
}) {
  const [preset, setPreset] = useState<Preset>(p.preset);
  const [from, setFrom] = useState(p.from);
  const custom = preset === "custom";
  return (
    <form action="/monitoring" className="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end" data-filters>
      <input type="hidden" name="tab" value={p.tab} />
      {p.view === "day" && <input type="hidden" name="view" value="day" />}
      <div className="lg:w-44">
        <label htmlFor="mf-range" className="label">Dates</label>
        <select id="mf-range" name="range" className="input" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
          {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {custom && (
        <>
          <div className="lg:w-44">
            <label htmlFor="mf-from" className="label">From</label>
            <input id="mf-from" type="date" name="from" className="input" max={p.today} value={from} onChange={(e) => setFrom(e.target.value)} required />
          </div>
          <div className="lg:w-44">
            <label htmlFor="mf-to" className="label">To</label>
            <input id="mf-to" type="date" name="to" className="input" min={from || undefined} max={p.today} defaultValue={p.to} required />
          </div>
        </>
      )}
      <div className="lg:w-44">
        <label htmlFor="mf-branch" className="label">Branch</label>
        <select id="mf-branch" name="branch" className="input" defaultValue={p.branch}>
          <option value="">All</option>
          {p.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className="lg:w-44">
        <label htmlFor="mf-type" className="label">Transaction</label>
        <select id="mf-type" name="type" className="input" defaultValue={p.type}>
          <option value="">All</option>
          {p.types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
      </div>
      {p.who && (
        <div className="lg:w-52">
          <label htmlFor="mf-who" className="label">{p.who.label}</label>
          <select id="mf-who" name={p.who.name} className="input" defaultValue={p.who.value}>
            <option value="">All, by group</option>
            {p.who.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      )}
      <button type="submit" className="btn-secondary">Apply</button>
    </form>
  );
}
