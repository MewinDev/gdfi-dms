import { LockIcon } from "./icons";

/**
 * A held transaction is readable but locked: every button and box inside is disabled (a disabled
 * fieldset, so nothing can be pressed or typed), greyed, with a small lock note saying why. The
 * server refuses the same actions with the same words (lib/services/locks.ts).
 */
export function LockedArea({ locked, message, children, id }: { locked: string | null; message?: string; children: React.ReactNode; id?: string }) {
  if (!locked) return <>{children}</>;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-locked>
      <p id={id} className="flex items-start gap-2 rounded-xl border border-line-soft bg-fill-soft px-3 py-2 text-[13px] text-ink-2" data-lock-note>
        <span className="mt-0.5 text-ink-2"><LockIcon size={14} strokeWidth={2.4} /></span>
        <span>{message ?? locked}</span>
      </p>
      <fieldset disabled aria-describedby={id} className="locked m-0 min-w-0 border-0 p-0">{children}</fieldset>
    </div>
  );
}
