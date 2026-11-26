import type { Tone } from "@/lib/ui/plain";

export interface LoanCardData {
  pn: string;
  borrowerName: string;
  branch: string;
  /** Null without "See loan amounts" (D-062). */
  amountText: string | null;
  action: string;
  chip: { text: string; tone: Tone } | null;
}
