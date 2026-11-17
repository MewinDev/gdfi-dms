import Link from "next/link";

/** Audit's two pages (shown only when the person has both ticks): the audit log and the file access log. */
export function AuditTabs({ current, audit, files }: { current: "audit" | "files"; audit: boolean; files: boolean }) {
  if (!(audit && files)) return null;
  const tab = (key: "audit" | "files", href: string, label: string) => (
    <Link href={href} aria-current={current === key ? "page" : undefined}
      className={`inline-flex min-h-11 items-center rounded-lg px-4 text-[15px] ${current === key ? "bg-navy font-semibold text-white" : "text-navy hover:bg-fill"}`}>{label}</Link>
  );
  return (
    <nav aria-label="Audit pages" className="inline-flex gap-1 rounded-xl border border-line-strong bg-white p-0.5" data-audit-tabs>
      {tab("audit", "/admin/audit", "Audit log")}
      {tab("files", "/admin/audit/files", "File access log")}
    </nav>
  );
}
