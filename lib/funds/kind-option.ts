import type { AmountMode } from "./kinds";

/** An expense kind as the forms need it (browser-safe). */
export interface KindOption {
  code: string;
  name: string;
  active: boolean;
  builtIn: boolean;
  sortOrder: number;
  amountMode: AmountMode;
  amountCents: number | null;
}
