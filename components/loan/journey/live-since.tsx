"use client";

import { useEffect, useState } from "react";

/** "2 h 5 min", "3 d 4 h": how long since an instant. */
export function sinceText(fromMs: number, nowMs: number): string {
  const min = Math.max(0, Math.floor((nowMs - fromMs) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * A live "for 2 h 5 min" count for open items. Starts from the server's time (so the first render
 * matches) and then ticks every minute in the browser.
 */
export function LiveSince({ since, now }: { since: string; now: string }) {
  const [t, setT] = useState(() => new Date(now).getTime());
  useEffect(() => {
    const id = window.setInterval(() => setT(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="tabular-nums" data-live-since>for {sinceText(new Date(since).getTime(), t)}</span>;
}
