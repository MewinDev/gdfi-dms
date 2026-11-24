import { fmtShort } from "@/lib/time";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openItemCounts, openItemsFor } from "@/lib/services/open-items";
import { AlertCard, AlertRow } from "@/components/home/home-ui";
import { RefreshIcon } from "@/components/ui/icons";

/**
 * Home, for approvers (piece 8, D-053): Open Items waiting for them, how many waited too long (red, the inbox
 * colours), and the oldest five. Shown only when something waits.
 */
export async function openItemsToDo(user: CurrentUser) {
  const counts = await openItemCounts(user);
  if (!counts) return null;
  const oldest = counts.waiting ? (await openItemsFor(user, "mine")).slice(0, 5) : [];
  return { ...counts, oldest };
}

export function OpenItemsCard({ data }: { data: NonNullable<Awaited<ReturnType<typeof openItemsToDo>>> }) {
  if (data.waiting + data.unassigned === 0) return null;
  return (
    <AlertCard id="oi-h" title="Open Items to decide" count={data.waiting} tone={data.tooLong ? "bad" : "act"} icon={<RefreshIcon size={15} />}
      reason={<>
        {data.tooLong > 0 && <strong className="text-bad-fg" data-oi-too-long>{data.tooLong} Open Item{data.tooLong === 1 ? "" : "s"} waiting too long. </strong>}
        myloans changed loans in your branches. Nothing changes until you approve.
        {data.unassigned > 0 && <> {data.unassigned} more in Unassigned (branches with no approver).</>}
      </>}
      link={{ href: "/open-items", label: "See all Open Items" }} data={{ "data-open-items-card": "" }} countData={{ "data-oi-count": "" }}>
      <ul>
        {data.oldest.map((i) => (
          <AlertRow key={i.id} href={`/open-items?pn=${i.loan.pn}`}>
            <span className="mono font-semibold text-navy">{i.loan.pn}</span>
            <span className="min-w-0 flex-1 truncate">{i.fieldLabel} · {i.loan.borrowerName}</span>
            <span className={`chip ${i.tone === "bad" ? "c-bad" : i.tone === "act" ? "c-act" : "c-ok"} h-6 text-xs`}>{i.waitingDays} working day{i.waitingDays === 1 ? "" : "s"}</span>
            <span className="basis-full text-[12px] text-ink-2 sm:basis-auto">{fmtShort(i.raisedAt)}</span>
          </AlertRow>
        ))}
      </ul>
    </AlertCard>
  );
}
