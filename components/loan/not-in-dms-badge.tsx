/**
 * D-060: the badge of a released loan that is not a loan file in the DMS yet (a branch pool item, or found only in
 * myloans): "myloans · Not yet in DMS", beside its release date (Loans table and cards, Inbox pool, the preview).
 * Its own soft violet (a source, not a status); AA contrast (lib/ui/design-tokens.test.ts). Loans in the DMS have none.
 */
export function NotInDmsBadge({ className = "" }: { className?: string }) {
  return <span className={`chip c-myloans h-5 whitespace-nowrap px-1.5 text-xs font-semibold ${className}`} data-not-in-dms>myloans · Not yet in DMS</span>;
}
