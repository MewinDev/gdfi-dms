import Link from "next/link";
import { AlertCard } from "@/components/home/home-ui";
import { InboxIcon } from "@/components/ui/icons";

/** Supervisors' Home (D-046): work waiting in the pool too long, and work with people who are away. */
export function WorkCountsCard({ poolTooLong, withAway }: { poolTooLong: number; withAway: number }) {
  const n = (poolTooLong ? 1 : 0) + (withAway ? 1 : 0);
  if (!n) return null;
  return (
    <AlertCard id="work-h" title="Work to move on" count={poolTooLong + withAway} tone="act" icon={<InboxIcon size={15} />} data={{ "data-work-counts": "" }}>
      <ul>
        {poolTooLong > 0 && (
          <li className="border-b border-line-soft px-3 py-2 text-[14px] last:border-0 sm:px-4" data-pool-too-long>
            <Link href="/inbox?tab=pool" className="font-semibold text-navy underline underline-offset-2">{poolTooLong} loan{poolTooLong === 1 ? "" : "s"} waiting in the pool too long</Link>
          </li>
        )}
        {withAway > 0 && (
          <li className="border-b border-line-soft px-3 py-2 text-[14px] last:border-0 sm:px-4" data-with-away>
            <Link href="/inbox?tab=away" className="font-semibold text-navy underline underline-offset-2">{withAway} loan{withAway === 1 ? " is" : "s are"} with people who are away</Link>
          </li>
        )}
      </ul>
    </AlertCard>
  );
}
