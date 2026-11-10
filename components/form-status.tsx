"use client";

import { useFormStatus } from "react-dom";

type State = { ok: boolean; message?: string; error?: string; field?: string } | null;

export function FormMessage({ state }: { state: State }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <p role="status" className="rounded-md bg-ok-bg px-3 py-2 text-xs text-ok-fg">
        {state.message}
      </p>
    );
  }
  return (
    <p role="alert" className="rounded-md bg-err-bg px-3 py-2 text-xs text-err-fg">
      {state.error}
    </p>
  );
}

export function SubmitButton({
  children,
  className = "btn-primary",
  pendingText,
  disabled,
  name,
  value,
  id,
  ...aria
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  /** The "Do this now" card's step button (focus moves to it when the step before is done). */
  "data-step-action"?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" id={id} className={className} disabled={pending || disabled} aria-busy={pending} name={name} value={value} {...aria}>
      {pending ? pendingText ?? "Saving..." : children}
    </button>
  );
}
