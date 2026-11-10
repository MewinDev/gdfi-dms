"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ActionState } from "@/lib/action";
import type { ApproveConfirmText } from "@/lib/funds/approve-confirm";

/**
 * Approve asks first: the button opens "Approve this request?" (the amount in bold, then one grey line),
 * and only the window's gold Approve submits the form it belongs to (decision=approve). Focus starts on
 * Cancel; Esc cancels; Enter on Approve confirms. While it works both buttons are disabled and it says
 * "Approving...". The window closes when the answer comes back (the row shows the message).
 */
export function ApproveConfirm({ formId, text, state, pending, label = "Approve", className = "btn-gold btn-sm fl-btn", name = "decision", value = "approve" }: {
  formId: string;
  text: ApproveConfirmText;
  state: ActionState;
  pending: boolean;
  label?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  // Open while the answer of this round is not back yet: a new state (ok or error) closes it.
  const [askedAt, setAskedAt] = useState<{ state: ActionState } | null>(null);
  const open = askedAt !== null && askedAt.state === state;
  return (
    <>
      <button type="button" className={className} onClick={() => setAskedAt({ state })} disabled={pending} data-approve-open>{label}</button>
      <ConfirmDialog
        open={open}
        title={text.title}
        body={(
          <>
            <span className="block text-2xl font-bold tabular-nums text-navy" data-approve-amount>{text.amount}</span>
            <span className="mt-1 block text-sm text-ink-2" data-approve-line>{text.line}</span>
          </>
        )}
        confirmLabel="Approve"
        pendingLabel="Approving..."
        tone="gold"
        sheetOnPhone
        pending={pending}
        confirmForm={formId}
        confirmName={name}
        confirmValue={value}
        onCancel={() => setAskedAt(null)}
        data="approve-confirm"
      />
    </>
  );
}

/**
 * One submit at a time: a second submit of the same form before the answer is back (a double tap, Enter
 * twice) is dropped. The server is idempotent as well, so a second approve could never approve twice.
 */
export function useOneSubmit(state: ActionState) {
  const sentFor = useRef<{ state: ActionState } | null>(null);
  return (e: React.FormEvent<HTMLFormElement>) => {
    if (sentFor.current && sentFor.current.state === state) { e.preventDefault(); return; }
    sentFor.current = { state };
  };
}
