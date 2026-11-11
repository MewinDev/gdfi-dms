"use client";

import { useEffect, useState } from "react";

const norm = (v: string) => v.trim().toUpperCase();

/**
 * The result or message of a Find a loan search, for the text that was searched (`q`). It is hidden as
 * soon as the text in the search box is no longer that text (typing, a sample, a suggestion) or a new
 * search for other text starts, so it never describes a different PN than the one in the box.
 */
export function FindResult({ q, children }: { q: string; children: React.ReactNode }) {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const onInput = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.id === "find-loan") setStale(norm(t.value) !== norm(q));
    };
    const onSubmit = (e: Event) => {
      const box = e.target instanceof HTMLFormElement ? e.target.querySelector<HTMLInputElement>("#find-loan") : null;
      if (box && norm(box.value) !== norm(q)) setStale(true);
    };
    document.addEventListener("input", onInput, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [q]);
  if (stale) return null;
  return <div className="flex min-w-0 flex-col gap-3" data-find-result={q}>{children}</div>;
}
