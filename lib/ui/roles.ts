/** "Document Processor / Collateral & Mortgage" → "DP · Collateral & Mortgage" (full name on hover and in the pop-up). */
export function shortRoleName(name: string): string {
  const [first, ...rest] = name.split(" / ");
  if (!rest.length) return name;
  const initials = first.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("");
  return `${initials} · ${rest.join(" / ")}`;
}
