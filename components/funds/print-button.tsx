"use client";

import { PrinterIcon } from "@/components/ui/icons";

/** Prints the page it sits on (the liquidation report). */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" className="btn-gold" onClick={() => window.print()} data-print-now>
      <PrinterIcon size={18} /> {label}
    </button>
  );
}
