"use client";

import { useRouter } from "next/navigation";
import { TOAST_KEY } from "./txn-switcher";
import { useMemo, useRef, useState, useTransition } from "react";
import { assignToDpAction } from "@/app/actions/loan";
import { Sheet } from "@/components/ui/sheet";
import { CheckIcon, CoinsIcon, LockIcon, MapPinIcon, UsersIcon, ChecklistIcon, WarningIcon } from "@/components/ui/icons";
import { initials, plainMessage } from "@/lib/ui/plain";
import { addRemarksText, receivedText, type MissingPaper } from "@/lib/workflow/checklist";
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
  /** sample (D-020): a warning shown when this office is picked. */
  ltoOffices: { id: string; name: string; sample?: string | null }[];
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
  /** After sending, open the next transaction that needs the LA (null: stay here). */
  next: { href: string; name: string } | null;
  /** A MyLoans change under review holds this transaction ("MyLoans changed this loan. An approver is reviewing it."). */
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
  return <span className={`chip c-${tone} h-5 shrink-0 px-1.5 text-[11px]`} data-availability={d.availStatus}>{d.availStatus === "ON_LEAVE" ? "On leave" : `${AVAILABILITY_LABEL[d.availStatus]} · ${d.availPct}%`}</span>;
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
  /** Ticked Present (a paper missing with remarks is answered, not received). */
  requiredReceived?: number;
  missing: MissingPaper[];
  /** Papers marked Missing whose reason and remarks are not saved yet: Send stays locked, naming them. */
  needsRemarks?: MissingPaper[];
  /** Ticks are complete but not saved yet (the transaction is still For checklist). */
  waitingForSave: boolean;
  savedText: string | null;
  goTo: (lineIds: string[]) => void;
}

/** Sessionstorage key: the job card shows "Sent to ..." once after the page refreshes. */
export const sentKey = (txnId: string) => `dms:sent:${txnId}`;

/**
 * "Send to a Document Processor": a ready check on top, funds (left) and who should do it (right),
 * the late reason when past the send date, and a footer that says what goes where and,
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
  const dpId = chosen === "POOL" ? "" : chosen && dpsHere.some((d) => d.id === chosen && !d.leave) ? chosen : o.resend ? "" : rec && !dpsHere.find((d) => d.id === rec)?.leave ? rec : "";
  // D-046: "Branch DP pool": any processor of the branch can accept it; the first accept wins.
  const pool = chosen === "POOL";
  const dp = pool ? null : o.dps.find((d) => d.id === dpId) ?? null;
  const who = pool ? `the ${branchName} DP pool` : dp?.name ?? null;
  const shown = showAll ? dpsHere : [...dpsHere.slice(0, 3), ...dpsHere.slice(3).filter((d) => d.id === dpId)];
  // From the type's "Needs LTO processing" setting (no type is special-cased).
  const ltoRequired = !!o.needsLto;
  const ltoName = o.ltoOffices.find((l) => l.id === lto)?.name ?? null;

  const fundsOk = funds === "NO" || (funds === "YES" && kinds.length > 0);
  const secondHere = o.dps.filter((d) => d.branchIds.includes(secondBranch) && d.id !== dpId && !d.leave);
  const secondDp = second ? secondHere.find((d) => d.id === secondPick) ?? null : null;
  const secondBranchName = o.branches.find((b) => b.id === secondBranch)?.name ?? "";
  const secondOk = !second || (!!secondDp && secondReason.trim().length >= 3);
  // Everything still missing, in order (D-062): the first is shown under the locked Send button with Show (it goes
  // there), and how many more are left. A hard block (myloans, papers back) stops the list.
  const papersLeft = p.missing.length;
  type Part = "papers" | "papersBack" | "funds" | "dp" | "second" | "lto" | "late";
  const blockers: { text: string; part?: Part }[] = [];
  if (o.sourceBlock) blockers.push({ text: o.sourceBlock });
  else if (o.papersBlock) blockers.push({ text: o.papersBlock, part: "papersBack" });
  else {
    if (!p.ready && papersLeft > 0) blockers.push({ text: `Tick ${papersLeft} more required paper${papersLeft === 1 ? "" : "s"}`, part: "papers" });
    else if (!p.ready && (p.needsRemarks ?? []).length > 0) blockers.push({ text: addRemarksText(p.needsRemarks!), part: "papers" });
    else if (!p.ready) blockers.push({ text: "Answer every paper", part: "papers" });
    else if (p.waitingForSave) blockers.push({ text: "Saving your ticks..." });
    if (!funds) blockers.push({ text: "Answer the funds question", part: "funds" });
    else if (funds === "YES" && kinds.length === 0) blockers.push({ text: "Pick what the funds are for", part: "funds" });
    if (!dp && !pool) blockers.push({ text: "Pick a processor", part: "dp" });
    if (second && !secondDp) blockers.push({ text: "Pick the second processor", part: "second" });
    else if (second && secondReason.trim().length < 3) blockers.push({ text: "Tell us why a second processor is needed", part: "second" });
    if (ltoRequired && !lto) blockers.push({ text: "Pick the LTO office", part: "lto" });
    if (o.pastDay2 && !late.trim()) blockers.push({ text: "Tell us why it is late", part: "late" });
  }
  const reason = blockers[0]?.text ?? null;
  const reasonPart = blockers[0]?.part;

  const go = (part: Part) => {
    if (part === "papers") { p.goTo((p.missing[0] ?? p.needsRemarks?.[0])?.lineIds ?? []); return; }
    if (part === "papersBack") { document.getElementById("papers-back")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const el = document.getElementById(`${part}-${uid}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el?.matches("select, textarea") ? el : el?.querySelector<HTMLElement>("input:not([type=hidden]), button"))?.focus({ preventScroll: true });
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
        else sessionStorage.setItem(sentKey(p.txnId), who ?? "");
      } catch { /* the toast is a nicety */ }
      // Move on to the next transaction that needs the LA.
      if (o.next) { router.push(o.next.href, { scroll: false }); window.scrollTo({ top: 0 }); }
    });
  };

  const ring = (part: string) => (flash === part ? "border-gold shadow-[0_0_0_3px_var(--act-bg)]" : "border-line");
  const reasonId = `send-why-${uid}`;

  // A paper missing with remarks is answered, not received.
  const missingPapers = p.requiredReceived === undefined ? 0 : p.requiredDone - p.requiredReceived;
  const papersText = missingPapers > 0 ? `Papers ${receivedText(p.requiredReceived!, p.requiredTotal, missingPapers)}` : `Papers ${p.requiredDone} of ${p.requiredTotal}`;
  return (
    <form
      ref={formRef}
      onSubmit={(e) => { e.preventDefault(); setErr(null); if (!reason && formRef.current?.reportValidity()) setConfirm(true); }}
      className="@container flex min-w-0 flex-col gap-2.5"
      aria-labelledby={`send-${uid}`}
      data-send-panel
    >
      <input type="hidden" name="transactionId" value={p.txnId} />
      <input type="hidden" name="loanId" value={o.loanId} />
      <input type="hidden" name="dpBranchId" value={branchId} />
      {second && <input type="hidden" name="pasuyo" value="on" />}
      <h3 id={`send-${uid}`} className="text-base font-bold text-navy" title="The processor is told right away by notification and email.">Send to a Document Processor</h3>
      {/* A decline is shown here; a return for papers already says what is needed above (not a problem). */}

      {/* 1. Ready check */}
      <ul aria-label="Ready to send?" className="flex flex-wrap gap-1.5">
        {o.papersBlock && <Check ok={false} icon={<ChecklistIcon size={13} />} okText="" badText="Papers back not confirmed" onGo={() => document.getElementById("papers-back")?.scrollIntoView({ behavior: "smooth", block: "center" })} />}
        <Check ok={p.ready} icon={<ChecklistIcon size={13} />} okText={papersText} badText={papersText} onGo={() => go("papers")} />
        <Check ok={fundsOk} icon={<CoinsIcon size={13} />} okText={funds === "YES" ? "Needs funds" : "No funds needed"} badText={funds === "YES" ? "Pick what the funds are for" : "Funds not answered"} onGo={() => go("funds")} />
        <Check ok={!!dp} icon={<UsersIcon size={13} />} okText={dp ? dp.name : ""} badText="No processor chosen" onGo={() => go("dp")} />
        {second && <Check ok={secondOk} icon={<UsersIcon size={13} />} okText={`Pasuyo: ${secondDp?.name ?? ""}`} badText={!secondDp ? "No second processor chosen" : "Pasuyo reason missing"} onGo={() => go("second")} />}
        {ltoRequired && <Check ok={!!lto} icon={<MapPinIcon size={13} />} okText={ltoName ?? ""} badText="No LTO office chosen" onGo={() => go("lto")} />}
      </ul>

      {/* 2. Funds (left) and who should do it (right) */}
      <div className="grid gap-2.5 @[44rem]:grid-cols-2 @[44rem]:items-start" data-send-columns>
        <fieldset id={`funds-${uid}`} className={`flex min-w-0 flex-col gap-1.5 rounded-lg border p-2.5 transition-shadow sm:p-3 ${ring("funds")}`} aria-describedby={`fk-help-${uid}`}>
          <legend className="sr-only">Does this transaction need funds?</legend>
          <p aria-hidden="true" className="text-[13px] font-semibold text-navy">Does this transaction need funds?</p>
          <div className="grid grid-cols-2 gap-1.5">
            {([["YES", "Needs funds"], ["NO", "No funds needed"]] as const).map(([v, l]) => (
              <label key={v} className={`flex h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-[13px] font-semibold md:h-8 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy ${funds === v ? "border-navy bg-navy text-white" : "border-line-input bg-white text-navy hover:border-navy/50"}`}>
                <input type="radio" name="fundsNeeded" value={v} checked={funds === v} onChange={() => setFunds(v)} className="sr-only" />
                {l}
              </label>
            ))}
          </div>
          {funds === "YES" && (
            <div role="group" aria-label="What are the funds for?" className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-ink-2">What are the funds for?</p>
              <div className="flex flex-wrap gap-1.5">
                {(o.kindChoices ?? FUND_KINDS).map(([k, l]) => {
                  const on = kinds.includes(k);
                  const sug = o.suggestedKinds.includes(k);
                  return (
                    <label key={k} data-suggested={sug ? "true" : undefined} className={`inline-flex h-11 cursor-pointer items-center gap-1 rounded-full border px-3 text-[13px] font-semibold md:h-8 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy ${on ? "border-navy bg-navy text-white" : sug ? "border-dashed border-gold bg-gold-soft text-navy" : "border-line-input bg-white text-navy"}`}>
                      <input type="checkbox" name="fundsKinds" value={k} checked={on} onChange={(e) => setKinds((x) => (e.target.checked ? [...x, k] : x.filter((y) => y !== k)))} className="sr-only" />
                      {on && <CheckIcon size={12} strokeWidth={3} />}
                      {l}
                      {sug && !on && <span className="text-[11px] font-medium text-act-fg">Suggested</span>}
                    </label>
                  );
                })}
              </div>
              {kinds.length === 0 && <p className="text-xs font-semibold text-act-fg">Pick at least one.{o.suggestedKinds.length ? " Suggested ones have a dashed border." : ""}</p>}
            </div>
          )}
          <p id={`fk-help-${uid}`} className="text-xs text-ink-2">The processor will ask Finance for the amount.</p>
        </fieldset>

        <fieldset id={`dp-${uid}`} className={`flex min-w-0 flex-col gap-1.5 rounded-lg border p-2.5 transition-shadow sm:p-3 ${ring("dp")}`}>
          <legend className="sr-only">Who should do it</legend>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p aria-hidden="true" className="text-[13px] font-semibold text-navy">Who should do it</p>
            {!otherBranch ? (
              <button type="button" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-navy underline underline-offset-2 md:min-h-8" onClick={() => setOtherBranch(true)}>Choose from another branch</button>
            ) : (
              <button type="button" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-navy underline underline-offset-2 md:min-h-8" onClick={() => { setOtherBranch(false); setBranchId(homeBranch); setChosen(null); setShowAll(false); }}>
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
              {branchId !== homeBranch && <p className="text-xs text-act-fg">This goes to a processor outside the loan&rsquo;s branch.</p>}
            </div>
          )}
          {dpsHere.length === 0 ? (
            <p className="rounded-lg bg-act-bg px-2.5 py-1.5 text-[13px] text-act-fg">
              No processor is available in {branchName}.{" "}
              {!otherBranch && <button type="button" className="font-semibold underline" onClick={() => setOtherBranch(true)}>Choose another branch</button>}
            </p>
          ) : (
            <div role="radiogroup" aria-label={`Processors in ${branchName}`} className="flex flex-col gap-1">
              {shown.map((d) => {
                const on = d.id === dpId;
                const off = !!d.leave;
                return (
                  <label key={d.id} data-dp-choice={d.name} aria-disabled={off || undefined} className={`flex min-h-11 items-center gap-2 rounded-lg border px-2 py-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy ${off ? "cursor-not-allowed border-line bg-fill opacity-70" : on ? "cursor-pointer border-navy bg-fill-soft shadow-[inset_0_0_0_1px_var(--navy)]" : "cursor-pointer border-line hover:border-navy/40"}`}>
                    <input type="radio" name="dpUserId" value={d.id} checked={on} disabled={off} onChange={() => setChosen(d.id)} className="sr-only" />
                    <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${on ? "bg-navy text-white" : "bg-fill-strong text-navy"}`}>{initials(d.name)}</span>
                    <span className="min-w-0 flex-1 leading-snug">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{d.name}</span>
                        <AvailabilityChip d={d} />
                        {d.id === rec && !off && <span className="chip c-ok h-5 shrink-0 px-1.5 text-[11px]">Recommended</span>}
                      </span>
                      <span className="block text-xs text-ink-2" data-dp-load>{off ? d.leave : d.capacity ? `${branchName} · ${d.open} of ${d.capacity}` : `${branchName} · ${d.open} open job${d.open === 1 ? "" : "s"}`}</span>
                    </span>
                    <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-navy bg-navy text-white" : "border-[rgb(12_35_64/0.3)]"}`}>{on && <CheckIcon size={10} strokeWidth={3} />}</span>
                  </label>
                );
              })}
              {dp?.availStatus === "FULL" && (
                <p className="rounded-lg border border-act-line bg-act-bg px-2.5 py-1.5 text-xs text-act-fg" data-full-warning>{dp.name} is full ({dp.open} of {dp.capacity} open jobs). You can still send it; it may take longer.</p>
              )}
              {dpsHere.length > 3 && (
                <button type="button" className="inline-flex min-h-11 items-center self-start text-[13px] font-semibold text-navy underline underline-offset-2 md:min-h-8" onClick={() => setShowAll((x) => !x)} aria-expanded={showAll}>
                  {showAll ? "Show fewer" : `Show all (${dpsHere.length})`}
                </button>
              )}
            </div>
          )}
          {dpsHere.length > 0 && (
            <div role="radiogroup" aria-label="Or the branch pool" className="flex flex-col gap-1">
              <label data-dp-choice="Branch DP pool" className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed px-2 py-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy ${pool ? "border-navy bg-fill-soft shadow-[inset_0_0_0_1px_var(--navy)]" : "border-line hover:border-navy/40"}`}>
                  <input type="radio" name="dpUserId" value="POOL" checked={pool} onChange={() => { setChosen("POOL"); setSecond(false); }} className="sr-only" />
                  <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${pool ? "bg-navy text-white" : "bg-fill-strong text-navy"}`}><UsersIcon size={14} /></span>
                  <span className="min-w-0 flex-1 leading-snug">
                    <span className="block text-sm font-semibold">Branch DP pool</span>
                    <span className="block text-xs text-ink-2">Any processor of {branchName} can accept it. The first to accept gets it.</span>
                  </span>
                  <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${pool ? "border-navy bg-navy text-white" : "border-[rgb(12_35_64/0.3)]"}`}>{pool && <CheckIcon size={10} strokeWidth={3} />}</span>
                </label>
            </div>
          )}
          {pool ? null : !second ? (
            <button type="button" className="inline-flex min-h-11 items-center self-start text-[13px] font-semibold text-navy underline underline-offset-2 md:min-h-8" onClick={() => setSecond(true)}>
              Also assign a second processor (Pasuyo)
            </button>
          ) : (
            <div id={`second-${uid}`} className={`flex flex-col gap-1.5 rounded-lg border p-2.5 transition-shadow ${ring("second")}`} role="group" aria-label="Second processor (Pasuyo)">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-[13px] font-semibold text-navy">Second processor (Pasuyo)</p>
                <button type="button" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-navy underline underline-offset-2 md:min-h-8" onClick={() => { setSecond(false); setSecondPick(""); setSecondReason(""); setSecondOther(false); setSecondBranch(homeBranch); }}>Remove second processor</button>
              </div>
              {!secondOther ? (
                <button type="button" className="inline-flex min-h-11 items-center self-start text-[13px] font-semibold text-navy underline underline-offset-2 md:min-h-8" onClick={() => setSecondOther(true)}>Choose from another branch</button>
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
            <div id={`lto-${uid}-box`} className={`rounded-lg transition-shadow ${ring("lto")}`}>
              <label htmlFor={`lto-${uid}`} className="label">LTO office</label>
              <select id={`lto-${uid}`} name="ltoOfficeId" required value={lto} onChange={(e) => setLto(e.target.value)} className="input" aria-invalid={err?.field === "ltoOfficeId"}>
                <option value="">Pick the LTO office</option>
                {o.ltoOffices.map((l) => <option key={l.id} value={l.id}>{l.name}{l.sample ? " (sample)" : ""}{o.ltoWarnings?.[l.id]?.length ? " (advisory)" : ""}</option>)}
              </select>
              {lto && o.ltoOffices.find((l) => l.id === lto)?.sample && <p className="mt-1.5 inline-flex rounded-lg bg-act-bg px-2 py-1 text-[13px] font-semibold text-act-fg" data-lto-sample>{o.ltoOffices.find((l) => l.id === lto)!.sample}</p>}
              <AdvisoryWarnings lines={lto ? o.ltoWarnings?.[lto] : undefined} />
            </div>
          )}
        </fieldset>
      </div>

      {/* 3. Late reason */}
      {o.pastDay2 && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-act-fg"><WarningIcon size={13} /> This is past the send date ({o.deadlineText}).</p>
          <label htmlFor={`late-${uid}`} className="label">Why is this late?</label>
          <textarea id={`late-${uid}`} name="beyondTatReason" required rows={1} maxLength={500} value={late} onChange={(e) => setLate(e.target.value)} className="input" aria-invalid={err?.field === "beyondTatReason"} />
        </div>
      )}

      {err && <p role="alert" className="rounded-lg bg-bad-bg px-3 py-1.5 text-[13px] text-bad-fg">{err.msg}</p>}

      {/* 4. Footer (D-062 review). A wide card: the summary on the left; Send and, right under it, why it is locked,
          right-aligned. A narrow card: the summary, then Send and the reason, left-aligned. A phone: the reason above a
          full-width Send, pinned at the bottom of the screen. */}
      <div className="flex flex-col gap-2.5 border-t border-[rgb(12_35_64/0.1)] pt-2.5 @[36rem]:flex-row @[36rem]:items-start @[36rem]:justify-between @[36rem]:gap-4" data-send-footer>
        <div className="min-w-0 flex-1 text-[13px] leading-snug" data-send-summary>
          <p data-send-where>
            {p.name} goes to {pool ? <strong>{who}</strong> : dp ? <><strong>{dp.name}</strong> ({branchName})</> : <><span className="text-ink-2">(no processor yet)</span> ({branchName})</>}{secondDp ? <>, with a second processor (Pasuyo) <strong>{secondDp.name}</strong> ({secondBranchName})</> : null}{ltoRequired && ltoName ? <>, processed at <strong>{ltoName}</strong></> : null}.
          </p>
          <p className="mt-0.5" data-send-funds>
            Funds: {funds ? <strong>{funds === "YES" ? "Needs funds" : "No funds needed"}</strong> : <span className="text-ink-2">not answered</span>}
            {funds === "YES" && kinds.length > 0 ? ` (${kinds.map(kindName).join(", ")})` : ""}.
          </p>
          <p role="status" aria-live="polite" className="text-xs text-ink-2">{p.savedText && <span className="mt-0.5 inline-flex items-center gap-1"><CheckIcon size={14} />{p.savedText}</span>}</p>
        </div>
        <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-1.5 border-t border-line bg-cream px-4 pb-[calc(8px+env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_12px_rgb(12_35_64/0.08)] max-sm:flex-col-reverse sm:static sm:z-auto sm:items-start sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none @[36rem]:max-w-[50%] @[36rem]:shrink-0 @[36rem]:items-end" data-send-actions>
          <button type="submit" className="btn-gold min-h-10 w-full px-4 text-[13px] sm:min-h-8 sm:w-auto sm:px-3" disabled={!!reason || pending} aria-describedby={reason ? reasonId : undefined}>
            {pool ? "Send to the branch pool" : dp ? `Send to ${dp.name}` : "Send to processor"}
          </button>
          {/* Why Send is locked: a lock and the first thing missing. The words themselves are the link: pressing them goes
              there and highlights it (the first unticked paper, the funds question, the processors, the LTO office). */}
          <p className={reason ? "flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-xs leading-5 sm:justify-start @[36rem]:justify-end @[36rem]:text-right" : "sr-only"} data-send-blocker>
            {reason && <span aria-hidden="true" className="text-act-fg"><LockIcon size={12} /></span>}
            <span id={reasonId} role="status" aria-live="polite" className="font-semibold text-act-fg">
              {reason && reasonPart ? (
                <button type="button" onClick={() => go(reasonPart)}
                  className="relative font-semibold text-act-fg underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy before:absolute before:-inset-y-3 before:inset-x-0 before:content-[''] md:before:hidden" data-send-go>
                  {reason}
                </button>
              ) : reason ?? ""}
            </span>
          </p>
        </div>
      </div>

      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Send it now?">
        <p className="text-[15px]">Send <strong>{p.name}</strong> for <strong>{p.borrower}</strong> to <strong>{who}</strong>{pool ? null : ` (${branchName})`}{secondDp ? <>, with a second processor (Pasuyo) <strong>{secondDp.name}</strong></> : null}?</p>
        {funds === "YES" && <p className="mt-2 text-sm text-ink-2">Flagged: needs funds ({kinds.map(kindName).join(", ")}). The processor will ask Finance.</p>}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" className="btn-gold min-h-11 px-5 text-sm md:min-h-9" onClick={send} disabled={pending}>{pending ? "Sending..." : "Send"}</button>
          <button type="button" className="btn-ghost min-h-11 px-5 text-sm md:min-h-9" onClick={() => setConfirm(false)}>Cancel</button>
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
        <span className="chip c-ok h-6 max-w-full gap-1 px-2 text-xs"><CheckIcon size={12} strokeWidth={2.6} /><span className="truncate">{okText}</span></span>
      ) : (
        <button type="button" onClick={onGo} className="chip c-act relative h-6 cursor-pointer gap-1 px-2 text-xs underline-offset-2 before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] hover:underline md:before:hidden" data-ready-go>{icon}{badText}</button>
      )}
    </li>
  );
}
