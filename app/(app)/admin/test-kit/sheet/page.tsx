import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { requirePageAny } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { kitPageOrNotFound } from "@/lib/kit/access";
import { PageHeader } from "@/components/ui/basics";

export const metadata: Metadata = { title: "Test sheet" };

/** The kit's sheets, shown on this page: the tester sheet, the answers and the scenarios. */
const DOCS = { sheet: "MANUAL-TEST-KIT.md", answers: "MANUAL-TEST-KIT-ANSWERS.md", scenarios: "MANUAL-TEST-KIT-SCENARIOS.md" } as const;
type DocKey = keyof typeof DOCS;
const hrefOf = (target: string) => {
  const key = (Object.keys(DOCS) as DocKey[]).find((k) => DOCS[k] === target);
  return key ? `/admin/test-kit/sheet${key === "sheet" ? "" : `?doc=${key}`}` : null;
};

/** Inline `code`, **bold** and links to the other kit sheets: the sheets use nothing else. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return <>{parts.map((p, i) => {
    if (p.startsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
    if (link) { const href = hrefOf(link[2]); return href ? <a key={i} href={href} className="link">{link[1]}</a> : link[1]; }
    return p;
  })}</>;
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** docs/MANUAL-TEST-KIT.md as a page: headings, paragraphs, lists and tables. */
function Sheet({ md }: { md: string }) {
  const lines = md.split(/\r?\n/);
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) {
      const Tag = (["h2", "h2", "h3"] as const)[h[1].length - 1];
      if (h[1].length > 1) out.push(<Tag key={i} className={h[1].length === 2 ? "mt-6 text-lg font-bold text-navy" : "mt-4 font-bold text-navy"}><Inline text={h[2]} /></Tag>);
      i++;
      continue;
    }
    if (l.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(cells(lines[i])); i++; }
      const [head, , ...body] = rows;
      out.push(
        <div key={i} className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-fill"><tr>{head.map((c, j) => <th key={j} scope="col" className="px-3 py-2 font-semibold text-navy">{c}</th>)}</tr></thead>
            <tbody>{body.map((r, k) => <tr key={k} className="border-t border-line align-top">{r.map((c, j) => <td key={j} className="px-3 py-2"><Inline text={c} /></td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      out.push(<ul key={i} className="list-disc space-y-1 pl-6">{items.map((t, k) => <li key={k}><Inline text={t} /></li>)}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||\s*[-*]\s)/.test(lines[i])) { para.push(lines[i].trim()); i++; }
    out.push(<p key={i} className="text-[15px]"><Inline text={para.join(" ")} /></p>);
  }
  return <div className="flex flex-col gap-3">{out}</div>;
}

/** The Manual Test Kit's test sheet. Not found unless the kit is available here (local test setup, gdfi_dms). */
export default async function TestSheetPage({ searchParams }: { searchParams: Promise<{ doc?: string }> }) {
  kitPageOrNotFound();
  await requirePageAny([PERMISSIONS.LOANS_VIEW, PERMISSIONS.TESTDATA_RESET]);
  const doc = ((await searchParams).doc ?? "sheet") as DocKey;
  const md = readFileSync(path.join(process.cwd(), "docs", DOCS[doc in DOCS ? doc : "sheet"]), "utf8");
  return (
    <div className="flex w-full flex-col gap-4" data-test-sheet>
      <PageHeader title="Test sheet" help="The Manual Test Kit: who signs in, what to do, what should happen." />
      <Sheet md={md} />
    </div>
  );
}
