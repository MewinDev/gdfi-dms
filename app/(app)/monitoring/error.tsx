"use client";

/** Monitoring could not load (for example the database did not answer): a plain message and Retry. */
export default function MonitoringError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-lg flex-col items-start gap-3 rounded-[14px] border border-line bg-white p-5" data-monitoring-error>
      <h1 className="text-xl font-bold text-navy">Monitoring did not load</h1>
      <p className="text-[15px] text-ink-2">Nothing was changed. Try again in a moment, or contact IT if it keeps happening.</p>
      <button type="button" onClick={reset} className="btn-gold min-h-11">Retry</button>
    </div>
  );
}
