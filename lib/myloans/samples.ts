import { mockRecords } from "./mock-data";
import type { MyLoansRecord } from "./types";

/**
 * Sample PNs shown to testers in TEST_MODE. The records themselves come from the mock MyLoans
 * adapter (unchanged), so a card always shows what "Find loan" will return.
 */
export interface SampleLoan {
  pn: string;
  tests: string;
  record: MyLoansRecord | null;
}

/** The three hand-picked sample loans. */
export const SAMPLE_PNS: { pn: string; tests: string }[] = [
  { pn: "GD1012026901001", tests: "No questions. Mortgage, 4 transactions." },
  { pn: "GD1652026901003", tests: "Pick Undertaking and OR/CR. Transferred gives 4, Untransferred gives 2." },
  { pn: "GD1652026901004", tests: "Not a mortgage. Notary and For EDST only." },
];

/** Other mock PNs used by the Data Check and rule tests (hidden unless Admin turns them on). */
export const DATA_CHECK_PNS: { pn: string; tests: string }[] = [
  { pn: "GD1012026901002", tests: "Financing, New 300,000: the two questions; Mortgage when Transferred." },
  { pn: "GD1012026901005", tests: "\"Auto Finance\" is not the word Financing, so Refinancing. Not a mortgage." },
  { pn: "GD1012026901006", tests: "Blank product name defaults to Refinancing. Mortgage." },
  { pn: "GD3902026901007", tests: "Other branch (Alaminos): refused, outside your branches." },
  { pn: "GD1652026901008", tests: "Not released yet in MyLoans: refused." },
  { pn: "GD1652026901009", tests: "Loan type Restructured: refused, must be New or Renewal." },
  { pn: "GD1652026901010", tests: "Amount 0: refused, must be above 0." },
  { pn: "GD1652026901011", tests: "Missing release date: refused." },
  { pn: "GD1012026999999", tests: "Not in MyLoans: \"PN not found\"." },
];

function withRecords(list: { pn: string; tests: string }[], now: Date): SampleLoan[] {
  const records = mockRecords(now);
  return list.map((s) => ({ ...s, record: records.find((r) => r.pn === s.pn) ?? null }));
}

/** Empty unless test mode is on. */
export function sampleLoans(testMode: boolean, now: Date = new Date()): SampleLoan[] {
  return testMode ? withRecords(SAMPLE_PNS, now) : [];
}

/** Empty unless test mode is on and the Admin setting is on. */
export function dataCheckSamples(testMode: boolean, showSetting: boolean, now: Date = new Date()): SampleLoan[] {
  return testMode && showSetting ? withRecords(DATA_CHECK_PNS, now) : [];
}
