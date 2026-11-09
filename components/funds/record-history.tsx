/** The history of a funds record (from its audit rows): requested, type changed, approved, released, receipts, closed. */
export function RecordHistory({ rows }: { rows: { id: string; text: string; when: string }[] }) {
  if (!rows.length) return null;
  return (
    <details className="text-[13px]" data-record-history>
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-navy">History ({rows.length})</summary>
      <ol className="mt-1 flex flex-col gap-1 border-l-2 border-line pl-3">
        {rows.map((r) => <li key={r.id}><span className="text-ink-2">{r.when}</span> · {r.text}</li>)}
      </ol>
    </details>
  );
}
