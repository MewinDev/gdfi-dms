"use client";

import { useActionState, useState } from "react";
import { resetTestDataAction, type ResetState } from "@/app/actions/admin";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ResetCounts } from "@/lib/test-data/reset-core";

const LABELS: [keyof ResetCounts, string][] = [
  ["loanFiles", "Loan files"],
  ["transactions", "Transactions"],
  ["checklistTicks", "Checklist ticks"],
  ["documents", "Documents (labels)"],
  ["labelsPrinted", "Labels printed"],
  ["edstRecords", "EDST records"],
  ["assignments", "Processor assignments"],
  ["cashAdvances", "Cash advances"],
  ["problems", "Problem reports"],
  ["notifications", "Notifications"],
  ["movements", "Custody movements"],
  ["transmittals", "Transmittals"],
  ["snapshots", "MyLoans snapshots"],
];

/** "Test data" card (Admin, TEST_MODE only; the page only renders it in test mode). */
export function ResetTestData() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (): Promise<ResetState> => {
    const r = await resetTestDataAction();
    setOpen(false);
    return r;
  }, null);

  return (
    <section aria-labelledby="test-data-title" className="card flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="test-data-title" className="text-lg font-bold text-navy">Test data</h2>
        <span className="rounded-md bg-fill-strong px-2 py-0.5 text-[11px] font-bold tracking-[0.08em] text-navy">TEST MODE</span>
      </div>
      <p className="text-[15px] text-ink-2">
        Start over with no loan files. Testers can then open the sample loans again from Find a loan.
      </p>
      <div>
        <button type="button" className="btn-danger" onClick={() => setOpen(true)}>Reset test data</button>
      </div>

      {state?.ok && state.counts && (
        <div role="status" className="rounded-xl bg-ok-bg px-4 py-3 text-ok-fg">
          <p className="font-semibold">Test data reset. Users, branches, settings and rules were kept.</p>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {LABELS.map(([k, l]) => <li key={k}>{l}: <strong>{state.counts![k]}</strong> removed</li>)}
          </ul>
        </div>
      )}
      {state && !state.ok && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-3 text-bad-fg">{state.error}</p>}

      <form id="reset-test-data-form" action={action} hidden />
      <ConfirmDialog
        open={open}
        title="Reset test data?"
        body="This removes all loan files and their documents, transactions, labels and assignments. Users, branches, settings and rules stay. This cannot be undone."
        confirmLabel="Yes, reset"
        tone="danger"
        confirmForm="reset-test-data-form"
        pending={pending}
        onCancel={() => setOpen(false)}
      />
    </section>
  );
}
