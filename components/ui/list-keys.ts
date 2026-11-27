/**
 * Rows that open a details panel (D-063 Inbox, D-064 Jobs): the arrow keys, Home and End move the focus to the
 * next, previous, first or last row of the same list (`[data-list-row]` buttons in one <ul>).
 */
export function listArrowKeys(e: React.KeyboardEvent<HTMLElement>) {
  const rows = [...(e.currentTarget.closest("ul")?.querySelectorAll<HTMLElement>("[data-list-row]") ?? [])];
  const i = rows.indexOf(e.currentTarget);
  const to = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : null;
  if (to === null) return;
  e.preventDefault();
  rows[Math.max(0, Math.min(rows.length - 1, to))]?.focus();
}
