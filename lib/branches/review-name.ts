/**
 * The short name of a Branch review item for the Home card: the branch name only ("Alicia", not
 * "Alicia (710)"). The stored title keeps the code, and the Branch review page, Settings > Branches and
 * every other place keep showing it. When two items in the same list have the same name, both keep
 * their code (shown in grey) so they can be told apart. "Code 777 (…)" items (an unknown code seen in a
 * PN) have no name of their own and stay as they are.
 */
export interface ReviewNameInput { title: string; code: string | null }
export interface ReviewName { name: string; code: string | null }

/** The title without its trailing " (code)", or the title itself. */
export function reviewBranchName(i: ReviewNameInput): string {
  const tail = i.code ? ` (${i.code})` : null;
  return tail && i.title.endsWith(tail) && i.title.length > tail.length ? i.title.slice(0, -tail.length) : i.title;
}

/** Names for a list; the code only where two names are the same. */
export function reviewNames(items: ReviewNameInput[]): ReviewName[] {
  const names = items.map(reviewBranchName);
  const seen = new Map<string, number>();
  for (const n of names) seen.set(n.toLowerCase(), (seen.get(n.toLowerCase()) ?? 0) + 1);
  return names.map((name, i) => ({ name, code: (seen.get(name.toLowerCase()) ?? 0) > 1 && name !== items[i].title ? items[i].code : null }));
}
