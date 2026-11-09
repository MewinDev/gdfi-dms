/** While the numbers load: grey skeleton tiles and rows in the same places, so nothing jumps. */
export function MonitoringSkeleton() {
  const bar = "rounded-md bg-fill-strong motion-safe:animate-pulse";
  return (
    <div className="flex w-full flex-col gap-4" aria-busy="true" aria-label="Loading Monitoring" data-monitoring-loading>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => <div key={i} className="flex h-[92px] flex-col gap-2 rounded-[14px] border border-line bg-white p-3"><div className={`${bar} h-3 w-20`} /><div className={`${bar} h-7 w-12`} /><div className={`${bar} h-3 w-24`} /></div>)}
      </div>
      <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-white p-3">
        <div className={`${bar} h-8 w-full bg-[#eef2f8]`} />
        {Array.from({ length: 6 }, (_, i) => <div key={i} className={`${bar} h-10 w-full`} />)}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
