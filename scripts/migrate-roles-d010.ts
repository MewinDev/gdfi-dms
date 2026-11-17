/**
 * npm run roles:migrate        dry run: lists the people the D-010 role migration would move (nothing written)
 * npm run roles:migrate -- --apply    writes it (one transaction, an audit row per person and per role)
 *
 * Branch Supervisor -> LA Supervisor/Head (its default now moves holds; per-person legacy grants removed and
 * listed, D-029); Approvers and
 * custom funds roles -> Finance (abilities kept exactly through grants and denies, Handles CA / FT set);
 * Operations Monitor -> "Monitoring (read-only)"; missing built-in roles created. lib/services/role-migration.ts.
 * Idempotent: a second run finds nothing to do.
 */
import { loadEnvFiles } from "@/lib/env/load-files";

loadEnvFiles([".env.local", ".env"]);

async function main() {
  const { prisma } = await import("@/lib/db");
  const { loadRolePlan, applyRoleMigration } = await import("@/lib/services/role-migration");
  const { databaseName } = await import("@/lib/env/load-files");
  const { permissionLabel } = await import("@/lib/auth/permissions");
  const apply = process.argv.includes("--apply");
  try {
    const plan = apply ? await applyRoleMigration() : await loadRolePlan();
    console.log(`${apply ? "Applied" : "Dry run (nothing written)"}: D-010 role migration on ${databaseName(process.env.DATABASE_URL) ?? "?"}`);
    console.log(`Roles to create: ${plan.createRoles.join(", ") || "none"}`);
    for (const r of plan.roleUpdates) console.log(`Role ${r.key}: ${r.deactivate ? `made inactive (${r.name})` : `now "${r.name}"${r.permissions ? " with its new ticks" : ""}`}`);
    for (const w of plan.warnings) console.log(`Note: ${w}`);
    console.log(`Legacy grants removed (D-029, D-038): ${plan.removals.length} people`);
    for (const r of plan.removals) {
      const kept = r.keys.filter((k) => !r.lost.includes(k));
      console.log(`- ${r.name} <${r.email}>${r.active ? "" : " (inactive)"}: ${r.lost.length ? `no longer has: ${r.lost.map(permissionLabel).join("; ")}` : "loses nothing"}${kept.length ? ` (now from the role: ${kept.map(permissionLabel).join("; ")})` : ""}`);
    }
    console.log(`People affected: ${plan.moves.length}`);
    for (const m of plan.moves) {
      console.log(`- ${m.name} <${m.email}>${m.active ? "" : " (inactive)"}: ${m.fromRole} -> ${m.toRole}`);
      if (m.grants.length) console.log(`    granted: ${m.grants.map(permissionLabel).join("; ")}`);
      if (m.denies.length) console.log(`    denied:  ${m.denies.map(permissionLabel).join("; ")}`);
      if (m.ticks) console.log(`    handles: ${[m.ticks.handlesCa && "cash advances", m.ticks.handlesFt && "fund transfers"].filter(Boolean).join(" and ") || "neither"}`);
    }
    if (!apply && (plan.moves.length || plan.roleUpdates.length || plan.createRoles.length || plan.removals.length)) console.log("Run again with --apply to write it.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
