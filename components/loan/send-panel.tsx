"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { TOAST_KEY } from "./txn-switcher";
import { useMemo, useRef, useState, useTransition } from "react";
import { assignToDpAction } from "@/app/actions/loan";
import { Sheet } from "@/components/ui/sheet";
import { CheckIcon, CoinsIcon, MapPinIcon, PrinterIcon, TagIcon, UsersIcon, ChecklistIcon, WarningIcon } from "@/components/ui/icons";
import { initials, plainMessage } from "@/lib/ui/plain";
import type { MissingPaper } from "@/lib/workflow/checklist";
import { AVAILABILITY_LABEL, AVAILABILITY_TONE, type AvailabilityStatus } from "@/lib/monitoring/rules";
import { AdvisoryWarnings } from "@/components/monitoring/advisory-forms";

type Result = { ok: boolean; message?: string; error?: string; field?: string; missing?: string[] } | null;

export const FUND_KINDS: [string, string][] = [["NOTARY_FEE", "Notary fee"], ["PPSR_FEE", "PPSR fee"], ["LTO_FEE", "LTO fee"], ["TRANSPORT", "Transport"], ["OTHER", "Other"]];


export interface SendOptions {
  loanId: string;
  branches: { id: string; name: string }[];
  /** Processors with their open jobs (assigned + in process + on hold), capacity and availability. */
  dps: SendDp[];
  /** Active LTO advisories by office id: warning lines under the office choice (never blocking). */
  ltoWarnings?: Record<string, string[]>;
  recommended: Record<string, string | null>;
  ltoOffices: { id: string; name: string }[];
  /** The type needs LTO processing (Settings, Transaction types): the LTO office is asked and required. */
  needsLto?: boolean;
  /** Pre-selected office: the one last used on this loan, else the branch's usual LTO office. */
  defaultLtoOfficeId?: string | null;
  defaultBranchId: string;
  /** Re-send after the processor returned it for papers: the same processor, pre-selected. */
  previousDpId?: string | null;
  /** Sent again after the DP declined or returned it (a new round): the processor is chosen again, nothing pre-selected. */
  resend?: boolean;
  pastDay2: boolean;
  deadlineText: string;
  /** The LA's funds flag so far (UNANSWERED until Send). */
  fundsNeeded: "UNANSWERED" | "YES" | "NO";
  fundsKinds: string[];
  /** Kinds with an active rule for this transaction type (Settings, Cash-advance rules). */
  suggestedKinds: string[];
  /** "What are the funds for?": active expense kinds (Settings > Expense kinds), Other last. */
  kindChoices?: [string, string][];
  /** Print labels for this transaction's papers (null: nothing to print or not allowed). */
  labelsHref: string | null;
  labelsPrinted: boolean;
  /** After sending, open the next transaction that needs the LA (null: stay here). */
  next: { href: string; name: string } | null;
  /** A MyLoans change under Admin review holds this transaction ("MyLoans changed this loan. Admin is reviewing."). */
  sourceBlock?: string | null;
  /** Returned with papers handed over: "Confirm you received the papers ... first" until the LA confirms them. */
  papersBlock?: string | null;
}

export interface SendDp {
  id: string;
  name: string;
  branchIds: string[];
  open: number;
  capacity?: number;
  availPct?: number;
  availStatus?: AvailabilityStatus;
  /** "On leave until Nov 14, 2026" (shown disabled), or null. */
  leave?: string | null;
}

/** The availability chip beside a processor: Available, Busy, Full or On leave (soft colours). */
export function AvailabilityChip({ d }: { d: SendDp }) {
  if (!d.availStatus) return null;
  const tone = AVAILABILITY_TONE[d.availStatus];
  return <span className={`chip c-${tone} shrink-0`} data-availability={d.availStatus}>{d.availStatus === "ON_LEAVE" ? "On leave" : `${AVAILABILITY_LABEL[d.availStatus]} · ${d.availPct}%`}</span>;
}

export interface SendPanelProps {
  txnId: string;
  code: string;
  name: string;
  borrower: string;
  status: string;
  o: SendOptions;
  /** Every required paper ticked (on screen). */
  ready: boolean;
  requiredDone: number;
  requiredTotal: number;
  missing: MissingPaper[];
  /** Ticks are complete but not saved yet (the transaction is still For checklist). */
  waitingForSave: boolean;
  savedText: string | null;
  goTo: (lineIds: string[]) => void;
}

/** Sessionstorage key: the job card shows "Sent to ..." once after the page refreshes. */
export const sentKey = (txnId: string) => `dms:sent:${txnId}`;

/**
 * "Send to a Document Processor": a ready check on top, funds (left) and who should do it (right),
 * the late reason when past the send date, labels, and a footer that says what goes where and,
 * while Send is locked, the first thing still missing.
 */
export function SendPanel(p: SendPanelProps) {
  const { o } = p;
  const uid = p.txnId;
  const homeBranch = o.defaultBranchId;
  const [branchId, setBranchId] = useState(homeBranch);
  const [otherBranch, setOtherBranch] = useState(false);
  const rec = o.recommended[branchId] ?? null;
  const [chosen, setChosen] = useState<string | null>(o.previousDpId ?? null);
  const [showAll, setShowAll] = useState(false);
  const [funds, setFunds] = useState<"" | "YES" | "NO">(o.fundsNeeded === "UNANSWERED" ? "" : o.fundsNeeded);
  const [kinds, setKinds] = useState<string[]>(o.fundsKinds);
  const kindName = (k: string) => (o.kindChoices ?? FUND_KINDS).find((x) => x[0] === k)?.[1] ?? k;
  const [lto, setLto] = useState(o.defaultLtoOfficeId && o.ltoOffices.some((l) => l.id === o.defaultLtoOfficeId) ? o.defaultLtoOfficeId : "");
  const [late, setLate] = useState("");
  // Second processor (Pasuyo): optional; a different processor from any branch, with a reason.
  const [second, setSecond] = useState(false);
  const [secondBranch, setSecondBranch] = useState(homeBranch);
  const [secondOther, setSecondOther] = useState(false);
  const [secondPick, setSecondPick] = useState("");
  const [secondReason, setSecondReason] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  const branchName = o.branches.find((b) => b.id === branchId)?.name ?? "";
  // Recommended first, then fewest open jobs.
  const dpsHere = useMemo(
    () => o.dps.filter((d) => d.branchIds.includes(branchId)).sort((a, b) => Number(!!a.leave) - Number(!!b.leave) || Number(b.id === rec) - Number(a.id === rec) || a.open - b.open || a.name.localeCompare(b.name)),
    [o.dps, branchId, rec],
  );
  const dpId = chosen && dpsHere.some((d) => d.id === chosen && !d.leave) ? chosen : o.resend ? "" : rec && !dpsHere.find((d) => d.id === rec)?.leave ? rec : "";
  const dp = o.dps.find((d) => d.id === dpId) ?? null;
  const shown = showAll ? dpsHere : [...dpsHere.slice(0, 3), ...dpsHere.slice(3).filter((d) => d.id === dpId)];
  // From the type's "Needs LTO processing" setting (no type is special-cased).
  const ltoRequired = !!o.needsLto;
  const ltoName = o.ltoOffices.find((l) => l.id === lto)?.name ?? null;

  const fundsOk = funds === "NO" || (funds === "YES" && kinds.length > 0);
  const secondHere = o.dps.filter((d) => d.branchIds.includes(secondBranch) && d.id !== dpId && !d.leave);
  const secondDp = second ? secondHere.find((d) => d.id === secondPick) ?? null : null;
  const secondBranchName = o.branches.find((b) => b.id === secondBranch)?.name ?? "";
  const secondOk = !second || (!!secondDp && secondReason.trim().length >= 3);
  // The first thing missing, in order. Shown beside the locked Send button.
  const papersLeft = p.missing.length;
  const reason = o.sourceBlock ? o.sourceBlock
    : o.papersBlock ? o.papersBlock
    : !p.ready ? `Tick ${papersLeft} more required paper${papersLeft === 1 ? "" : "s"}`
    : p.waitingForSave ? "Saving your ticks..."
    : !funds ? "Answer the funds question"
    : funds === "YES" && kinds.length === 0 ? "Pick what the funds are for"
    : !dp ? "Pick a processor"
    : second && !secondDp ? "Pick the second processor"
    : second && secondReason.trim().length < 3 ? "Tell us why a second processor is needed"
    : ltoRequired && !lto ? "Pick the LTO office"
    : o.pastDay2 && !late.trim() ? "Tell us why it is late"
    : null;

  const go = (part: "papers" | "funds" | "dp" | "second" | "lto") => {
    if (part === "papers") { p.goTo(p.missing[0]?.lineIds ?? []); return; }
    const el = document.getElementById(`${part}-${uid}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el?.matches("select") ? el : el?.querySelector<HTMLElement>("input:not([type=hidden]), button"))?.focus({ preventScroll: true });
    setFlash(part);
    window.setTimeout(() => setFlash(null), 2500);
  };

  const send = () => {
    const f = new FormData(formRef.current!);
    start(async () => {
      const r = (await assignToDpAction(null, f)) as Result;
      setConfirm(false);
      if (!r?.ok) { setErr({ msg: plainMessage(r?.error), field: r?.field }); return; }
      try {
        if (o.next) sessionStorage.setItem(TOAST_KEY, `${p.name} sent. Next: ${o.next.name}`);
        else sessionStorage.setItem(sentKey(p.txnId), dp?.name ?? "");
      } catch { /* the toast is a nicety */ }
      // Move on to the next transaction that needs the LA.
      if (o.next) { router.push(o.next.href, { scroll: false }); window.scrollTo({ top: 0 }); }
    });
  };

  const ring = (part: string) => (flash === part ? "border-gold shadow-[0_0_0_3px_var(--act-bg)]" : "border-line");
  const reasonId = `send-why-${uid}`;

  return (
    <form
      ref={formRef}
      onSubmit={(e) => { e.preventDefault(); setErr(null); if (!reason && formRef.current?.reportValidity()) setConfirm(true); }}
      className="flex flex-col gap-3"
      aria-labelledby={`send-${uid}`}
    >
      <input type="hidden" name="transactionId" value={p.txnId} />
      <input type="hidden" name="loanId" value={o.loanId} />
      <input type="hidden" name="dpBranchId" value={branchId} />
      {second && <input type="hidden" name="pasuyo" value="on" />}
      <div>
        <h3 id={`send-${uid}`} className="text-[15px] font-bold text-navy" title="The processor is told right away by notification and email.">Send to a Document Processor</h3>
        <p className="text-[13px] text-ink-2">{p.name} · {p.borrower}</p>
      </div>
      {/* A decline is shown here; a return for papers already says what is needed above (not a problem). */}

      {/* 1. Ready check */}
      <ul aria-label="Ready to send?" className="flex flex-wrap gap-2">
        {o.papersBlock && <Check ok={false} icon={<ChecklistIcon size={16} />} okText="" badText="Papers back not confirmed" onGo={() => document.getElementById("papers-back")?.scrollIntoView({ behavior: "smooth", block: "center" })} />}
        <Check ok={p.ready} icon={<ChecklistIcon size={16} />} okText={`Papers ${p.requiredDone} of ${p.requiredTotal}`} badText={`Papers ${p.requiredDone} of ${p.requiredTotal}`} onGo={() => go("papers")} />
        <Check ok={fundsOk} icon={<CoinsIcon size={16} />} okText={funds === "YES" ? "Needs funds" : "No funds needed"} badText={funds === "YES" ? "Pick what the funds are for" : "Funds not answered"} onGo={() => go("funds")} />
        <Check ok={!!dp} icon={<UsersIcon size={16} />} okText={dp ? dp.name : ""} badText="No processor chosen" onGo={() => go("dp")} />
        {second && <Check ok={secondOk} icon={<UsersIcon size={16} />} okText={`Pasuyo: ${secondDp?.name ?? ""}`} badText={!secondDp ? "No second processor chosen" : "Pasuyo reason missing"} onGo={() => go("second")} />}
        {ltoRequired && <Check ok={!!lto} icon={<MapPinIcon size={16} />} okText={ltoName ?? ""} badText="No LTO office chosen" onGo={() => go("lto")} />}
      </ul>

      {/* 2. Funds (left) and who should do it (right) */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <fieldset id={`funds-${uid}`} className={`flex min-w-0 flex-col gap-2 rounded-xl border p-3 transition-shadow ${ring("funds")}`} aria-describedby={`fk-help-${uid}`}>
          <legend className="sr-only">Does this transaction need funds?</legend>
          <p aria-hidden="true" className="text-[15px] font-semibold text-navy">Does this transaction need funds?</p>
          <div className="grid grid-cols-2 gap-2">
            {([["YES", "Needs funds"], ["NO", "No funds needed"]] as const).map(([v, l]) => (
              <label key={v} className={`flex h-12 cursor-pointer items-center justify-center rounded-xl border-2 px-2 text-center text-[15px] font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy ${funds === v ? "border-navy bg-navy text-white" : "border-line-input bg-white text-navy hover:border-navy/50"}`}>
                <input type="radio" name="fundsNeeded" value={v} checked={funds === v} onChange={() => setFunds(v)} className="sr-only" />
                {l}
              </label>
            ))}
          </div>
          {funds === "YES" && (
            <div role="group" aria-label="What are the funds for?" className="flex flex-col gap-1.5">
              <p className="text-[13px] font-semibold text-ink-2">What are the funds for?</p>
              <div className="flex flex-wrap gap-2">
                {(o.kindChoices ?? FUND_KINDS).map(([k, l]) => {
                  const on = kinds.includes(k);
                  const sug = o.suggestedKinds.includes(k);
                  return (
                    <label key={k} data-suggested={sug ? "true" : undefined} className={`inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border-2 px-3.5 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy ${on ? "border-navy bg-navy text-white" : sug ? "border-dashed border-gold bg-gold-soft text-navy" : "border-line-input bg-white text-navy"}`}>
                      <input type="checkbox" name="fundsKinds" value={k} checked={on} onChange={(e) => setKinds((x) => (e.target.checked ? [...x, k] : x.filter((y) => y !== k)))} className="sr-only" />
                      {on && <CheckIcon size={14} strokeWidth={3} />}
                      {l}
                      {sug && !on && <span className="text-[11px] font-medium text-act-fg">Suggested</span>}
                    </label>
                  );
                })}
              </div>
              {kinds.length === 0 && <p className="text-[13px] font-semibold text-act-fg">Pick at least one.{o.suggestedKinds.length ? " Suggested ones have a dashed border." : ""}</p>}
            </div>
          )}
          <p id={`fk-help-${uid}`} className="text-[13px] text-ink-2">The processor will ask Finance for the amount.</p>
        </fieldset>

        <fieldset id={`dp-${uid}`} className={`flex min-w-0 flex-col gap-2 rounded-xl border p-3 transition-shadow ${ring("dp")}`}>
          <legend className="sr-only">Who should do it</legend>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p aria-hidden="true" className="text-[15px] font-semibold text-navy">Who should do it</p>
            {!otherBranch ? (
              <button type="button" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-navy underline underline-offset-2" onClick={() => setOtherBranch(true)}>Choose from another branch</button>
            ) : (
              <button type="button" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-navy underline underline-offset-2" onClick={() => { setOtherBranch(false); setBranchId(homeBranch); setChosen(null); setShowAll(false); }}>
                Back to {o.branches.find((b) => b.id === homeBranch)?.name ?? "this branch"}
              </button>
            )}
          </div>
          {otherBranch && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`b-${uid}`} className="label">Branch</label>
              <select id={`b-${uid}`} value={branchId} onChange={(e) => { setBranchId(e.target.value); setChosen(null); setShowAll(false); }} className="input">
                {o.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {branchId !== homeBranch && <p className="text-[13px] text-act-fg">This goes to a processor outside the loan&rsquo;s branch.</p>}
            </div>
          )}
          {dpsHere.length === 0 ? (
            <p className="rounded-lg bg-act-bg px-3 py-2 text-[15px] text-act-fg">
              No processor is available in {branchName}.{" "}
              {!otherBranch && <button type="button" className="font-semibold underline" onClick={() => setOtherBranch(true)}>Choose another branch</button>}
            </p>
          ) : (
            <div role="radiogroup" aria-label={`Processors in ${branchName}`} className="flex flex-col gap-1.5">
              {shown.map((d) => {
                const on = d.id === dpId;
                const off = !!d.leave;
                return (
                  <label key={d.id} data-dp-choice={d.name} aria-disabled={off || undefined} className={`flex min-h-14 items-center gap-3 rounded-xl border-2 px-3 py-1.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy ${off ? "cursor-not-allowed border-line bg-fill opacity-70" : on ? "cursor-pointer border-navy bg-fill-soft" : "cursor-pointer border-line hover:border-navy/40"}`}>
                    <input type="radio" name="dpUserId" value={d.id} checked={on} disabled={off} onChange={() => setChosen(d.id)} className="sr-only" />
                    <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${on ? "bg-navy text-white" : "bg-fill-strong text-navy"}`}>{initials(d.name)}</span>
                    <span className="min-w-0 flex-1 leading-snug">
                      <span className="block truncate text-[15px] font-semibold">{d.name}</span>
                      <span className="block text-[13px] text-ink-2" data-dp-load>{off ? d.leave : d.capacity ? `${branchName} · ${d.open} of ${d.capacity}` : `${branchName} · ${d.open} open job${d.open === 1 ? "" : "s"}`}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <AvailabilityChip d={d} />
                        {d.id === rec && !off && <span className="chip c-ok shrink-0">Recommended</span>}
                      </span>
                    </span>
                    <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-navy bg-navy text-white" : "border-[rgb(12_35_64/0.3)]"}`}>{on && <CheckIcon size={12} strokeWidth={3} />}</span>
                  </label>
                );
              })}
              {dp?.availStatus === "FULL" && (
                <p className="rounded-lg border border-act-line bg-act-bg px-3 py-2 text-[13px] text-act-fg" data-full-warning>{dp.name} is full ({dp.open} of {dp.capacity} open jobs). You can still send it; it may take longer.</p>
              )}
              {dpsHere.length > 3 && (
                <button type="button" className="inline-flex min-h-11 items-center self-start text-[13px] font-semibold text-navy underline underline-offset-2" onClick={() => setShowAll((x) => !x)} aria-expanded={showAll}>
                  {showAll ? "Show fewer" : `Show all (${dpsHere.length})`}
                </button>
              )}
            </div>
          )}
          {!second ? (
            <button type="button" className="inline-flex min-h-11 items-center self-start text-[13px] font-semibold text-navy underline underline-offset-2" onClick={() => setSecond(true)}>
              Also assign a second processor (Pasuyo)
            </button>
          ) : (
            <div id={`second-${uid}`} className={`flex flex-col gap-2 rounded-xl border p-3 transition-shadow ${ring("second")}`} role="group" aria-label="Second processor (Pasuyo)">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-[15px] font-semibold text-navy">Second processor (Pasuyo)</p>
                <button type="button" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-navy underline underline-offset-2" onClick={() => { setSecond(false); setSecondPick(""); setSecondReason(""); setSecondOther(false); setSecondBranch(homeBranch); }}>Remove second processor</button>
              </div>
              {!secondOther ? (
                <button type="button" className="inline-flex min-h-11 items-center self-start text-[13px] font-semibold text-navy underline underline-offset-2" onClick={() => setSecondOther(true)}>Choose from another branch</button>
              ) : (
                <div>
                  <label htmlFor={`sb-${uid}`} className="label">Branch</label>
                  <select id={`sb-${uid}`} value={secondBranch} onChange={(e) => { setSecondBranch(e.target.value); setSecondPick(""); }} className="input">
                    {o.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor={`sdp-${uid}`} className="label">Second processor</label>
                <select id={`sdp-${uid}`} name="secondaryDpUserId" value={secondDp?.id ?? ""} onChange={(e) => setSecondPick(e.target.value)} className="input" aria-invalid={err?.field === "secondaryDpUserId"}>
                  <option value="">{secondHere.length ? "Pick a different processor" : `No other processor in ${secondBranchName}`}</option>
                  {secondHere.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.capacity ? `${d.open} of ${d.capacity}` : `${d.open} open job${d.open === 1 ? "" : "s"}`}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`pr-${uid}`} className="label">Why is a second processor needed?</label>
                <input id={`pr-${uid}`} name="pasuyoReason" value={secondReason} onChange={(e) => setSecondReason(e.target.value)} maxLength={300} className="input" aria-invalid={err?.field === "pasuyoReason"} />
              </div>
            </div>
          )}
          {ltoRequired && (
            <div id={`lto-${uid}-box`} className={`rounded-xl transition-shadow ${ring("lto")}`}>
              <label htmlFor={`lto-${uid}`} className="label">LTO office</label>
              <select id={`lto-${uid}`} name="ltoOfficeId" required value={lto} onChange={(e) => setLto(e.target.value)} className="input" aria-invalid={err?.field === "ltoOfficeId"}>
                <option value="">Pick the LTO office</option>
                {o.ltoOffices.map((l) => <option key={l.id} value={l.id}>{l.name}{o.ltoWarnings?.[l.id]?.length ? " (advisory)" : ""}</option>)}
              </select>
              <AdvisoryWarnings lines={lto ? o.ltoWarnings?.[lto] : undefined} />
              <p className="help">Where the processor takes it. The approver uses it to judge transport and time.</p>
            </div>
          )}
        </fieldset>
      </div>

      {/* 3. Late reason */}
      {o.pastDay2 && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-act-fg"><WarningIcon size={14} /> This is past the send date ({o.deadlineText}).</p>
          <label htmlFor={`late-${uid}`} className="label">Why is this late?</label>
          <textarea id={`late-${uid}`} name="beyondTatReason" required rows={2} maxLength={500} value={late} onChange={(e) => setLate(e.target.value)} className="input" aria-invalid={err?.field === "beyondTatReason"} />
        </div>
      )}

      {/* 5. Labels (not required to send) */}
      {o.labelsHref && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {o.labelsPrinted
            ? <span className="chip c-ok"><CheckIcon size={14} strokeWidth={2.6} />Labels printed</span>
            : <span className="chip c-act h-auto min-h-6 whitespace-normal py-0.5"><TagIcon size={14} />Labels not printed yet. Print them before handing over the papers</span>}
          <Link href={o.labelsHref} className="btn-ghost btn-sm"><PrinterIcon size={16} /> Print labels</Link>
        </div>
      )}

      {err && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-[15px] text-bad-fg">{err.msg}</p>}

      {/* 4. Footer: summary and Send (pinned at the bottom on phone) */}
      <div className="flex flex-col gap-2 border-t border-[rgb(12_35_64/0.1)] pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-[15px]">
          <p>
            {p.name} goes to {dp ? <strong>{dp.name}</strong> : <span className="text-ink-2">(no processor yet)</span>} ({branchName}){secondDp ? <>, with a second processor (Pasuyo) <strong>{secondDp.name}</strong> ({secondBranchName})</> : null}{ltoRequired && ltoName ? <>, processed at <strong>{ltoName}</strong></> : null}.{" "}
            Funds: {funds ? <strong>{funds === "YES" ? "Needs funds" : "No funds needed"}</strong> : <span className="text-ink-2">not answered</span>}
            {funds === "YES" && kinds.length > 0 ? ` (${kinds.map(kindName).join(", ")})` : ""}.
          </p>
          <p role="status" aria-live="polite" className="text-[13px] text-ink-2">{p.savedText && <span className="inline-flex items-center gap-1"><CheckIcon size={14} />{p.savedText}</span>}</p>
        </div>
        <div className="fixed inset-x-0 bottom-[calc(69px+env(safe-area-inset-bottom))] z-20 flex flex-col gap-1.5 border-t border-line bg-cream px-4 pb-3 pt-3 shadow-[0_-4px_12px_rgb(12_35_64/0.08)] sm:static sm:shadow-none sm:z-auto sm:shrink-0 sm:flex-row-reverse sm:items-center sm:border-0 sm:bg-transparent sm:p-0">
          <button type="submit" className="btn-gold h-12 w-full px-6 sm:w-auto" disabled={!!reason || pending} aria-describedby={reason ? reasonId : undefined}>
            {dp ? `Send to ${dp.name}` : "Send to processor"}
          </button>
          <p id={reasonId} role="status" aria-live="polite" className={reason ? "text-center text-[13px] font-semibold text-act-fg sm:text-right" : "sr-only"}>{reason ?? ""}</p>
        </div>
      </div>

      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Send it now?">
        <p className="text-base">Send <strong>{p.name}</strong> for <strong>{p.borrower}</strong> to <strong>{dp?.name}</strong> ({branchName}){secondDp ? <>, with a second processor (Pasuyo) <strong>{secondDp.name}</strong></> : null}?</p>
        {funds === "YES" && <p className="mt-2 text-[15px] text-ink-2">Flagged: needs funds ({kinds.map(kindName).join(", ")}). The processor will ask Finance.</p>}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
          <button type="button" className="btn-gold btn-lg" onClick={send} disabled={pending}>{pending ? "Sending..." : "Send"}</button>
          <button type="button" className="btn-ghost btn-lg" onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      </Sheet>
    </form>
  );
}

/** One ready-check item. Met: a green tick. Not met: gold, and a link that scrolls to and highlights its part. */
function Check({ ok, icon, okText, badText, onGo }: { ok: boolean; icon: React.ReactNode; okText: string; badText: string; onGo: () => void }) {
  return (
    <li>
      {ok ? (
        <span className="chip c-ok h-8 max-w-full"><CheckIcon size={14} strokeWidth={2.6} /><span className="truncate">{okText}</span></span>
      ) : (
        <button type="button" onClick={onGo} className="chip c-act h-8 cursor-pointer underline-offset-2 hover:underline">{icon}{badText}</button>
      )}
    </li>
  );
}
