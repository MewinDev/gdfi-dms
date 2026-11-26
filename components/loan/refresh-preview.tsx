"use client";

import { useFormStatus } from "react-dom";
import { refreshPreviewAction } from "@/app/actions/loan";
import { RefreshIcon } from "@/components/ui/icons";

/**
 * Icon only (the user's review, 26 November 2026): a compact 28px square with a border. Its name shows in a small
 * popover under it on hover or keyboard focus (the sidebar tooltips' navy style), right-aligned so it stays inside the
 * card; screen readers get the same name from aria-label. On a phone an invisible margin keeps 44px to tap. While
 * myloans answers, the icon spins.
 */
function Submit() {
  const { pending } = useFormStatus();
  const label = pending ? "Asking myloans..." : "Refresh from myloans";
  return (
    <span className="group/refresh relative inline-flex">
      <button
        type="submit"
        aria-label={label}
        disabled={pending}
        className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-line-input bg-white text-navy hover:bg-fill disabled:opacity-60 before:absolute before:-inset-2 before:content-[''] md:before:hidden"
        data-refresh-preview
      >
        <RefreshIcon size={15} className={pending ? "animate-spin" : undefined} />
      </button>
      <span
        aria-hidden="true"
        className="pointer-events-none invisible absolute right-0 top-full z-20 mt-1.5 whitespace-nowrap rounded-lg bg-navy px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-lg ring-1 ring-white/20 transition-opacity group-hover/refresh:visible group-hover/refresh:opacity-100 group-has-[:focus-visible]/refresh:visible group-has-[:focus-visible]/refresh:opacity-100"
        data-refresh-popover
      >
        {label}
      </span>
    </span>
  );
}

/** D-060: the preview page's Refresh from myloans: asks API 1 again (past the short cache); the page shows the new answer. */
export function RefreshPreviewButton({ pn }: { pn: string }) {
  return (
    <form action={refreshPreviewAction} className="inline-flex">
      <input type="hidden" name="pn" value={pn} />
      <Submit />
    </form>
  );
}
