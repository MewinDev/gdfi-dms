import { redirect } from "next/navigation";

/** The old Journey address: the Journey is now a tab of the Loan File. */
export default async function OldJourneyRoute({ params }: { params: Promise<{ pn: string }> }) {
  const { pn } = await params;
  redirect(`/loans/${encodeURIComponent(decodeURIComponent(pn).toUpperCase())}?tab=journey`);
}
