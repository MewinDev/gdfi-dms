"use client";

import { useFormStatus } from "react-dom";
import { refreshPreviewAction } from "@/app/actions/loan";
import { RefreshIcon } from "@/components/ui/icons";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-ghost btn-sm gap-2" disabled={pending} data-refresh-preview>
      <RefreshIcon size={16} /> {pending ? "Asking myloans..." : "Refresh from myloans"}
    </button>
  );
}

/** D-060: the preview page's Refresh from myloans: asks API 1 again (past the short cache); the page shows the new answer. */
export function RefreshPreviewButton({ pn }: { pn: string }) {
  return (
    <form action={refreshPreviewAction}>
      <input type="hidden" name="pn" value={pn} />
      <Submit />
    </form>
  );
}
