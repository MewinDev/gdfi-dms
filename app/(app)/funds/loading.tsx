/** Funds while it loads: grey placeholder rows (cards on a phone) in the same places, so nothing jumps. */
export default function FundsLoading() {
  const bar = (w: string) => <span className={`block h-3 rounded bg-fill-strong motion-safe:animate-pulse ${w}`} />;
  return (
    <div className="dense flex w-full min-w-0 flex-col gap-4" aria-busy="true" aria-label="Loading Funds">
      <div className="flex flex-col gap-3">
        <span className="block h-8 w-32 rounded bg-fill-strong" />
        <span className="block h-4 w-80 max-w-full rounded bg-fill" />
        <div className="flex gap-4 overflow-hidden border-b border-line pb-3">{["w-24", "w-24", "w-24", "w-16"].map((w, i) => <span key={i} className={`block h-5 shrink-0 rounded bg-fill ${w}`} />)}</div>
      </div>
      <span className="block h-3 w-48 rounded bg-fill" />
      <div className="fl">
        <div className="fl-rows">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="fl-row" aria-hidden="true">
              <div className="fl-req flex flex-col gap-2">{bar("w-28")}{bar("w-16")}</div>
              <div className="fl-loan flex flex-col gap-2">{bar("w-36")}{bar("w-28")}</div>
              <div className="fl-for flex flex-col gap-2">{bar("w-40")}{bar("w-48")}</div>
              <div className="fl-asked flex flex-col gap-2">{bar("w-28")}{bar("w-20")}</div>
              <div className="fl-amt flex flex-col items-end gap-2">{bar("w-20")}</div>
              <div className="fl-status flex flex-col items-end gap-2">{bar("w-28")}</div>
              <div className="fl-act">{bar("w-24")}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
