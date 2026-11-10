import { PERMISSION_GROUPS, ROLE_DEFAULTS, permissionLabel } from "@/lib/auth/permissions";
import { ALLOW_LIST } from "@/lib/auth/permission-scan";

/**
 * The generated part of docs/workflow/12-permissions.md (between the two markers), built from the
 * catalogue in lib/auth/permissions.ts and the allow-list in lib/auth/permission-scan.ts, so the document
 * cannot drift from the code. `npm run docs:permissions` writes it; lib/docs/permissions-doc.test.ts
 * fails when the file is out of date.
 */
export const DOC_FILE = "docs/workflow/12-permissions.md";
export const START = "<!-- generated:permissions:start (npm run docs:permissions; do not edit by hand) -->";
export const END = "<!-- generated:permissions:end -->";

/** Short role names for the defaults column (the seeded built-in roles). */
const ROLE_SHORT: Record<string, string> = {
  LA: "LA", ADMIN: "Admin", DP: "DP", FIN: "Finance", VAULT: "Vault", DIG: "Digital Records", QA: "QA", APPR: "Approvers", MONITOR: "Operations Monitor", SUP: "Branch Supervisor",
};

const cell = (s: string) => s.replace(/\|/g, "\\|");

/** Gap: the feature had no check, or decided by a role's name. Split: one old tick became several. */
export function auditMark(was: string, key: string): string {
  if (/^none\b/.test(was) || /by (its|role) name/.test(was)) return "**Gap, closed**";
  if (was === key) return "";
  return "Split or renamed";
}

export function renderPermissionsDoc(): string {
  const out: string[] = [START, ""];
  out.push("## The catalogue", "");
  out.push("Every tick in Settings, Roles, by group, in the order the role editor shows them. **Default roles** are the built-in roles that have it after a fresh install (Reset to default restores these). The technical name is what the server checks; the role editor shows it only with \"Show technical names\" on.", "");
  for (const g of PERMISSION_GROUPS) {
    out.push(`### ${g.label}`, "");
    out.push("| Tick | What it lets the person do | Where it appears | Needs | Technical name | Default roles |", "|---|---|---|---|---|---|");
    for (const i of g.items) {
      const roles = Object.entries(ROLE_DEFAULTS).filter(([, d]) => d.permissions.includes(i.key)).map(([k]) => ROLE_SHORT[k] ?? k);
      const needs = (i.requires ?? []).map(permissionLabel).join(", ");
      out.push(`| ${cell(i.label)}${i.view ? ` (Change; View is ${cell(permissionLabel(i.view))})` : ""} | ${cell(i.help)} | ${cell(i.where)} | ${cell(needs || "-")} | \`${i.key}\` | ${roles.join(", ") || "None (tick it on a role)"} |`);
    }
    out.push("");
  }
  out.push("## Audit: before and after this pass", "");
  out.push("One row per feature. **Permission today** is what decided it before the permissions pass (\"none\" means no check on the server, or only the role's name); **Permission after this pass** is the tick that decides it now. Every gap is closed.", "");
  out.push("| Feature | Where it appears | Permission today | Permission after this pass | Gap |", "|---|---|---|---|---|");
  for (const g of PERMISSION_GROUPS) for (const i of g.items) out.push(`| ${cell(i.label)} | ${cell(i.where)} | ${cell(i.was)} | \`${i.key}\` | ${auditMark(i.was, i.key)} |`);
  out.push("");
  out.push("## Server entry points without a permission tick", "");
  out.push("Every server action and API route checks a permission (a test scans `app/actions`, `app/login/actions.ts` and `app/api` and fails otherwise). Only these are allowed without one, each with its own check:", "");
  out.push("| Entry point | Why | Its own check |", "|---|---|---|");
  for (const a of ALLOW_LIST) out.push(`| \`${a.file}\` ${a.name} | ${cell(a.why)} | \`${a.mustContain.replace(/\($/, "")}\` |`);
  out.push("", END);
  return out.join("\n");
}

/** The document with its generated part replaced. */
export function withGenerated(doc: string): string {
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a < 0 || b < 0) throw new Error(`${DOC_FILE}: the generated markers are missing.`);
  return doc.slice(0, a) + renderPermissionsDoc() + doc.slice(b + END.length);
}
