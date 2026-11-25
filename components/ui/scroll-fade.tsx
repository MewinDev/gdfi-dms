"use client";

import { useEffect, useRef } from "react";

/**
 * D-058: a row of tabs that scrolls sideways on a narrow screen. A soft fade shows at the edge that has more
 * (globals.css, [data-scroll-fade]), and the selected tab (aria-current="page") is scrolled into view on load.
 * The child that scrolls carries data-scroll-row; this wrapper does not scroll, so the fade stays put.
 */
export function ScrollFade({ className = "", children }: { className?: string; children: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = wrap.current;
    const row = w?.querySelector<HTMLElement>("[data-scroll-row]");
    if (!w || !row) return;
    const update = () => {
      const more = row.scrollWidth - row.clientWidth;
      const edges = [row.scrollLeft > 2 ? "start" : "", more - row.scrollLeft > 2 ? "end" : ""].filter(Boolean).join(" ");
      w.setAttribute("data-scroll-fade", edges);
    };
    const cur = row.querySelector<HTMLElement>('[aria-current="page"]');
    if (cur && row.scrollWidth > row.clientWidth) {
      const r = cur.offsetLeft + cur.offsetWidth;
      if (r > row.clientWidth) row.scrollLeft = cur.offsetLeft - 24;
    }
    update();
    row.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(row);
    return () => { row.removeEventListener("scroll", update); ro.disconnect(); };
  }, []);
  return <div ref={wrap} className={`min-w-0 ${className}`} data-scroll-fade="">{children}</div>;
}
