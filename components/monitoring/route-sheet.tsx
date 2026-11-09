"use client";

import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";

/** A drill-down pop-up opened by the URL (the filters stay in it); closing goes back to the page without it. */
export function RouteSheet({ title, closeHref, children }: { title: string; closeHref: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Sheet open onClose={() => router.push(closeHref, { scroll: false })} title={title} side>
      <div data-drilldown>{children}</div>
    </Sheet>
  );
}
