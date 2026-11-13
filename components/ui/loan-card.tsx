import type { Tone } from "@/lib/ui/plain";

export interface LoanCardData {
  pn: string;
  borrowerName: string;
  branch: string;
  amountText: string;
  action: string;
  chip: { text: string; tone: Tone } | null;
}
