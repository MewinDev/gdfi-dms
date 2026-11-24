"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form-status";
import { monitoredFieldsAction } from "@/app/actions/open-items";
import { SAVED_EVENT } from "@/components/admin/settings-modal";

/** Settings, Open Items (D-012): the fields that raise Open Items. The status always does (it blocks Forward). */
export function OpenItemsFieldsForm({ formId, fields, on, canEdit }: { formId: string; fields: { key: string; label: string; group: boolean; borrower: boolean }[]; on: string[]; canEdit: boolean }) {
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof monitoredFieldsAction>>, fd: FormData) => {
    const r = await monitoredFieldsAction(prev, fd);
    if (r?.ok) window.dispatchEvent(new Event(SAVED_EVENT));
    return r;
  }, null);
  return (
    <form id={formId} action={action} data-track-dirty className="flex flex-col gap-3" data-open-items-fields>
      <p className="text-sm">A change in myloans to a ticked field waits as an Open Item for an approver of the loan&rsquo;s branch. The status in myloans always does: a loan that left Released does not move on until it is decided.</p>
      <fieldset className="flex flex-col gap-1" disabled={!canEdit}>
        <legend className="label">Fields that raise Open Items</legend>
        <label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="checkbox" checked disabled className="h-5 w-5" />Status in myloans <span className="text-[13px] text-ink-2">(always)</span></label>
        {fields.map((f) => (
          <label key={f.key} className="flex min-h-11 items-center gap-3 text-[15px]">
            <input type="checkbox" name="fields" value={f.key} defaultChecked={on.includes(f.key)} className="h-5 w-5 accent-[var(--navy)]" />
            {f.label}{f.group && <span className="text-[13px] text-ink-2">(decided with the other rule fields)</span>}{f.borrower && <span className="text-[13px] text-ink-2">(&ldquo;Review borrower detail corrections&rdquo; decides)</span>}
          </label>
        ))}
      </fieldset>
      <p className="text-[13px] text-ink-2">Area, division, company, branch and product names are never Open Items: they update by themselves and are listed in Reference data changes.</p>
      <FormMessage state={state} />
    </form>
  );
}
