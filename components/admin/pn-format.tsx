"use client";

import { useActionState, useMemo, useState } from "react";
import { savePnFormatAction } from "@/app/actions/pn";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { describePn, examplePn, parsePn, pnHeadline, type PnFormat } from "@/lib/pn/format";

/**
 * Settings, System, PN format: the parts and their rules, an example, the generated pattern, a switch
 * that turns the check off, and "Try a PN" (checked live in the browser with the same parser Find loan uses).
 */
export function PnFormatForm({ value, readOnly = false }: { value: PnFormat; readOnly?: boolean }) {
  const [state, action] = useActionState(savePnFormatAction, null);
  const [f, setF] = useState(value);
  const [tryText, setTryText] = useState("gd 101-2026-9-00001");
  const d = useMemo(() => describePn(f), [f]);
  const result = useMemo(() => (tryText.trim() ? parsePn(tryText, f) : null), [tryText, f]);
  const set = <K extends keyof PnFormat>(k: K, v: PnFormat[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const patternBox = (
      <div className="rounded-xl bg-fill px-3 py-2 text-sm" data-pn-pattern>
        <p>Pattern: <span className="mono font-semibold text-navy">{d.pattern}</span> · {d.length} characters · Example <span className="mono font-semibold text-navy">{examplePn(f)}</span></p>
        <ul className="mt-1 grid gap-x-4 text-[13px] text-ink-2 sm:grid-cols-2">
          {d.parts.map((p) => <li key={p.label}><span className="mono text-navy">{p.example}</span> {p.label}: {p.rule}</li>)}
        </ul>
      </div>
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-white p-4" aria-labelledby="pn-format-h" data-pn-format>
      <div>
        <h3 id="pn-format-h" className="font-semibold">PN format</h3>
        <p className="text-xs text-ink-2">Find loan, the search box, imports and MyLoans calls all check a PN with these rules before anything is looked up. Spaces, dashes and dots are removed first, so a pasted &ldquo;gd 101-2026-9-00001&rdquo; works.</p>
      </div>
      {readOnly ? (
        <div className="flex flex-col gap-3" data-pn-readonly>
          <p className="text-sm">PN check: <span className={`chip ${f.enabled ? "c-ok" : "bg-warn-bg text-warn-fg"}`}>{f.enabled ? "On" : "Off: any PN is looked up"}</span></p>
          {patternBox}
          <p className="text-[13px] text-ink-2">Read only. Ask an Admin to turn on &ldquo;Change the PN format&rdquo; for your role to change it.</p>
        </div>
      ) : (
      <form action={action} className="flex flex-col gap-3">
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
          <input type="checkbox" name="enabled" checked={f.enabled} onChange={(e) => set("enabled", e.target.checked)} className="h-5 w-5 accent-[var(--navy)]" />
          Check the PN format
          <span className={`chip ${f.enabled ? "c-ok" : "bg-warn-bg text-warn-fg"}`}>{f.enabled ? "On" : "Off: any PN is looked up"}</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-5">
          <div><label htmlFor="pn-prefix" className="label">Prefix</label><input id="pn-prefix" name="prefix" value={f.prefix} onChange={(e) => set("prefix", e.target.value.toUpperCase())} className="input mono" maxLength={5} /></div>
          <div><label htmlFor="pn-branch" className="label">Branch code digits</label><input id="pn-branch" name="branchDigits" inputMode="numeric" value={f.branchDigits} onChange={(e) => set("branchDigits", num(e.target.value))} className="input" /></div>
          <div>
            <label htmlFor="pn-year" className="label">Year digits</label>
            <select id="pn-year" name="yearDigits" value={f.yearDigits} onChange={(e) => set("yearDigits", num(e.target.value))} className="input"><option value="4">4</option><option value="2">2</option></select>
          </div>
          <div><label htmlFor="pn-system" className="label">System digit</label><input id="pn-system" name="system" value={f.system} onChange={(e) => set("system", e.target.value.replace(/\D/g, ""))} className="input mono" maxLength={2} /></div>
          <div><label htmlFor="pn-running" className="label">Running number digits</label><input id="pn-running" name="runningDigits" inputMode="numeric" value={f.runningDigits} onChange={(e) => set("runningDigits", num(e.target.value))} className="input" /></div>
        </div>
        {patternBox}
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Save PN format</SubmitButton>
          <FormMessage state={state} />
        </div>
      </form>
      )}
      <div className="border-t border-line pt-3">
        <label htmlFor="pn-try" className="label">Try a PN</label>
        <input id="pn-try" value={tryText} onChange={(e) => setTryText(e.target.value)} className="input mono" autoComplete="off" spellCheck={false} />
        <p aria-live="polite" className="mt-1 text-sm" data-pn-try-result>
          {!result ? null : result.ok ? (
            <span className="text-ok-fg">
              Looks right: <span className="mono font-semibold">{result.pn}</span>
              {result.parts && <> · branch {result.parts.branchCode}, year {result.parts.year}, running number {result.parts.running}</>}
            </span>
          ) : (
            <span className="text-bad-fg">{pnHeadline(f)}. {result.message}</span>
          )}
        </p>
      </div>
    </section>
  );
}
