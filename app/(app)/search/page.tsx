import { redirect } from "next/navigation";

/** D-059: the old Find a loan page. Its search is the Loans page's now (one box); old links and bookmarks land there. */
export default async function FindLoanPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim();
  redirect(q ? `/loans?q=${encodeURIComponent(q)}` : "/loans?find=1");
}
