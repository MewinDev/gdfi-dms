/**
 * The characters that differ between two texts, for the Borrower details review ("Ana Cruz" → "Anna
 * Cruz": the extra "n" is marked). Pure. A longest-common-subsequence per character for texts up to 300
 * characters; longer texts mark the middle between the common start and end.
 */
export interface Part { text: string; changed: boolean }

function merge(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    if (!p.text) continue;
    const last = out.at(-1);
    if (last && last.changed === p.changed) last.text += p.text; else out.push({ ...p });
  }
  return out;
}

export function charDiff(was: string, now: string): { was: Part[]; now: Part[] } {
  if (was === now) return { was: merge([{ text: was, changed: false }]), now: merge([{ text: now, changed: false }]) };
  if (was.length > 300 || now.length > 300) {
    let s = 0;
    while (s < was.length && s < now.length && was[s] === now[s]) s++;
    let e = 0;
    while (e < was.length - s && e < now.length - s && was[was.length - 1 - e] === now[now.length - 1 - e]) e++;
    const side = (t: string) => merge([{ text: t.slice(0, s), changed: false }, { text: t.slice(s, t.length - e), changed: true }, { text: t.slice(t.length - e), changed: false }]);
    return { was: side(was), now: side(now) };
  }
  const a = [...was], b = [...now];
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pa: Part[] = [], pb: Part[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { pa.push({ text: a[i], changed: false }); pb.push({ text: b[j], changed: false }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) pa.push({ text: a[i++], changed: true });
    else pb.push({ text: b[j++], changed: true });
  }
  while (i < a.length) pa.push({ text: a[i++], changed: true });
  while (j < b.length) pb.push({ text: b[j++], changed: true });
  return { was: merge(pa), now: merge(pb) };
}
