"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { refreshFoundLoanAction } from "@/app/actions/loan";

/**
 * The row action (View details) as a small pill (the user's review, D-060): 24px, 12px text, a navy outline that
 * fills on hover. On a phone an invisible margin keeps 44px to tap.
 */
export const ROW_BUTTON = "relative inline-flex h-6 items-center whitespace-nowrap rounded-full border border-navy bg-white px-2.5 text-xs font-semibold text-navy no-underline hover:bg-navy hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-[''] md:before:hidden";

/** A full PN that is a loan file here: one background refresh from myloans when the saved copy is old (as before). */
export function RefreshFound({ pn }: { pn: string }) {
  const router = useRouter();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (done.current === pn) return;
    done.current = pn;
    refreshFoundLoanAction(pn).then((r) => { if (r.changed) router.refresh(); }).catch(() => null);
  }, [pn, router]);
  return null;
}
