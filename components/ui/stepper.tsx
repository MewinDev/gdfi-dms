"use client";

import { useState } from "react";
import { STEPS, STEP_COUNT, type StepperAt } from "@/lib/workflow/stage-map";
import { CheckIcon, ChevronRightIcon, PauseIcon } from "./icons";
import { Sheet } from "./sheet";

type StepState = "Done" | "Now" | "Later";

/**
 * The whole journey: 10 steps (names from the stage map, lib/workflow/stage-map.ts). Desktop (1024px and
 * up): one slim row of 20px dots on a thin line with 12px labels, wrapping to two lines (done green with a
 * tick, current gold, later grey outline). Under 1024px (tablet and phone) the longer names do not fit in
 * a tenth of the width, so it shows only the current step: "Step 6 of 10 · Collateral" with a 10-segment
 * bar; tapping it lists all 10 steps. `at` comes from stepperOf(stage): a stage
 * with no step (cancelled, archived, disposed) highlights no step and shows its word small and grey under
 * the stepper. An open problem turns the current dot red; an open hold turns it navy with a pause icon.
 * The problem wins when both are open.
 */
export function Stepper({ at, problem, hold }: {
  at: StepperAt;
  /** Open problem on the current step: the dot turns red. */
  problem?: { reason: string; days: number } | null;
  /** Open hold on the current step: the dot turns navy with a pause icon (a problem wins). */
  hold?: { reason: string; days: number } | null;
}) {
  const onHold = !problem && hold ? hold : null;
  const [open, setOpen] = useState(false);
  const n = STEP_COUNT;
  const { current, doneThrough, word } = at;
  const now = current ? STEPS[current - 1] : null;
  const stepState = (k: number): StepState => (k <= doneThrough ? "Done" : k === current ? "Now" : "Later");
  const edge = 100 / n / 2;
  // The green line reaches the current dot (or, with no current step, the last done one).
  const doneWidth = Math.max(0, Math.min(current ? current - 1 : doneThrough - 1, n - 1)) * (100 / n);
  const pText = problem
    ? `Problem ${problem.days} day${problem.days === 1 ? "" : "s"} · ${problem.reason}`
    : onHold ? `On hold ${onHold.days} day${onHold.days === 1 ? "" : "s"} · ${onHold.reason}` : "";
  const describe = (i: number) => `${STEPS[i].name}. ${STEPS[i].who}. ${stepState(i + 1)}.${pText && i + 1 === current ? ` ${pText}.` : ""}`;
  const summary = now ? `Step ${current} of ${n} · ${now.name}${pText ? ` · ${pText}` : ""}` : doneThrough >= n ? `All ${n} steps done` : `${doneThrough} of ${n} steps done`;
  const mark = problem ? "problem" : onHold ? "hold" : undefined;

  return (
    <section aria-label="Progress" className="card px-3 py-2.5 lg:px-4 lg:py-3" data-stepper data-current-step={current ?? undefined}>
      {/* Phone and tablet (under 1024px): one compact line and a 10-segment bar; tap for the full list */}
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="flex w-full flex-col gap-1.5 text-left lg:hidden">
        <span className="flex w-full items-center justify-between gap-2">
          <span className={`flex items-center gap-1.5 text-[15px] font-semibold ${problem ? "text-bad-fg" : "text-navy"}`}>{onHold && <span className="text-hold-fg"><PauseIcon size={16} /></span>}{summary}</span>
          <span className="text-ink-2"><ChevronRightIcon size={18} /></span>
        </span>
        <span className="flex w-full gap-1" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s.n} className={`h-1.5 flex-1 rounded ${i + 1 <= doneThrough ? "bg-ok-fg" : i + 1 === current ? (problem ? "bg-[var(--bad-fg)]" : onHold ? "bg-[var(--hold-stripe)]" : "bg-gold") : "bg-fill-strong"}`} />
          ))}
        </span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="All 10 steps">
        <ol className="flex flex-col">
          {STEPS.map((s, i) => {
            const st = stepState(i + 1);
            return (
              <li key={s.n} className="flex min-h-12 items-center gap-3 border-b border-line last:border-0" aria-current={st === "Now" ? "step" : undefined}>
                <Dot n={i + 1} state={st} mark={mark} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-[15px] ${st === "Now" ? "font-bold text-navy" : "text-ink"}`}>{s.name}</span>
                  <span className="block text-[13px] text-ink-2">{s.who}</span>
                </span>
                <span className={`chip ${st === "Done" ? "c-ok" : st === "Now" ? "c-act" : "c-mute"}`}>{st}</span>
              </li>
            );
          })}
        </ol>
      </Sheet>

      {/* Desktop (1024px and up): one slim row with all 10 names */}
      <div className="relative hidden lg:block">
        <span aria-hidden="true" className="absolute top-[9px] h-0.5 bg-line" style={{ left: `${edge}%`, right: `${edge}%` }} />
        <span aria-hidden="true" className="absolute top-[9px] h-0.5 bg-ok-fg" style={{ left: `${edge}%`, width: `${doneThrough >= n ? 100 - 2 * edge : doneWidth}%` }} />
        <ol className="relative flex">
          {STEPS.map((s, i) => {
            const st = stepState(i + 1);
            return (
              <li key={s.n} data-step-name={s.name} className="flex min-w-0 flex-1 flex-col items-center gap-1" aria-current={st === "Now" ? "step" : undefined}>
                <span role="img" aria-label={describe(i)} title={describe(i)}><Dot n={i + 1} state={st} mark={mark} /></span>
                <span aria-hidden="true" className={`line-clamp-2 px-0.5 text-center text-xs leading-tight ${st === "Now" ? "font-bold text-navy" : st === "Done" ? "text-navy" : "text-ink-2"}`}>{s.name}</span>
              </li>
            );
          })}
        </ol>
      </div>
      {/* A stage with no step: its word, small and grey, under the stepper. */}
      {word && <p className="mt-1.5 text-center text-xs text-ink-2 lg:mt-2" data-stage-word>{word}</p>}
    </section>
  );
}

function Dot({ n, state, mark }: { n: number; state: "Done" | "Now" | "Later"; mark?: "problem" | "hold" }) {
  if (state === "Done") {
    return (
      <span className="z-[1] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok-fg text-white">
        <CheckIcon size={12} strokeWidth={3} />
      </span>
    );
  }
  if (state === "Now" && mark === "hold") {
    return (
      <span className="z-[1] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[var(--hold-stripe)] bg-hold-bg text-hold-fg" data-dot="hold">
        <PauseIcon size={11} strokeWidth={3} />
      </span>
    );
  }
  return (
    <span className={`z-[1] flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${state === "Now" ? (mark === "problem" ? "bg-[var(--bad-fg)] text-white" : "bg-gold text-navy") : "border-[1.5px] border-[rgb(12_35_64/0.3)] bg-white text-[rgb(12_35_64/0.55)]"}`}>
      {n}
    </span>
  );
}
