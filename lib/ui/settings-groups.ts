/** Settings cards, grouped so it is clear what belongs together. Order matters. */
export const SETTINGS_GROUPS = [
  { key: "company", label: "Company setup", help: "Who and where.", cards: ["branches", "lto", "loan-types"] },
  { key: "people", label: "People and access", help: "Who can do what.", cards: ["roles"] },
  { key: "documents", label: "Documents and steps", help: "What papers each transaction needs.", cards: ["transaction-types", "document-types", "checklist", "processing-stages", "problem-reasons", "hold-reasons", "return-reasons"] },
  { key: "time-money", label: "Time and money", help: "How long steps take and what funds are set aside.", cards: ["tat", "holidays", "cash-advance", "approval-bands"] },
  { key: "system", label: "System and testing", help: "MyLoans sync, email, test switches and sample data.", cards: ["system", "myloans-sync", "email", "test-data"] },
] as const;

export type SettingsCardKey = (typeof SETTINGS_GROUPS)[number]["cards"][number];

/** Cards shown in each group. Test data only in test mode; a group with no cards is left out. */
export function visibleSettingsGroups(
  testMode: boolean,
  groups: readonly { key: string; label: string; help: string; cards: readonly SettingsCardKey[] }[] = SETTINGS_GROUPS,
) {
  return groups.map((g) => ({
    key: g.key,
    label: g.label,
    help: g.help,
    cards: g.cards.filter((c) => c !== "test-data" || testMode),
  })).filter((g) => g.cards.length > 0);
}
