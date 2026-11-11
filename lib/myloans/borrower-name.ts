/**
 * The borrower's name from MyLoans' parts: "First Middle Last Suffix", empty parts skipped and spaces
 * collapsed. When the personal parts are all empty and there is a company name, the company name.
 * (Never reads TitleId or BirthDate.)
 */
export function composeBorrowerName(p: { first?: unknown; middle?: unknown; last?: unknown; suffix?: unknown; company?: unknown }): string {
  const part = (v: unknown) => (v === undefined || v === null ? "" : String(v).replace(/\s+/g, " ").trim());
  const personal = [p.first, p.middle, p.last, p.suffix].map(part).filter(Boolean).join(" ");
  return personal || part(p.company);
}
