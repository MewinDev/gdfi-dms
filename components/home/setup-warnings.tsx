import { prisma } from "@/lib/db";
import { branchesWithoutApprover, noApproverText } from "@/lib/services/borrower-review";
import { AlertCard } from "@/components/home/home-ui";
import { UsersIcon } from "@/components/ui/icons";

/**
 * The Superadmin's Home (people who manage permissions): setup gaps that only they can fix.
 *   - branches with no approver of their own (D-029; items there stay visible to All-branches approvers);
 *   - only one active Superadmin left (D-028: keep two, so one can fix the other's access).
 */
export async function setupWarnings(): Promise<string[]> {
  const [noApprover, supers] = await Promise.all([
    branchesWithoutApprover(),
    prisma.user.count({ where: { active: true, role: { key: "SUPERADMIN", active: true } } }),
  ]);
  const out: string[] = [];
  if (noApprover.length) {
    const names = noApprover.slice(0, 5).map((b) => b.name).join(", ");
    out.push(`${noApproverText(noApprover.length)} ${names}${noApprover.length > 5 ? " and more" : ""}. Give someone of the branch the approver tick on Users, Edit.`);
  }
  if (supers === 1) out.push("Only one active Superadmin is left. Add a second one on Users, so someone can always fix the other's access.");
  if (supers === 0) out.push("No active Superadmin. Nobody can change the permission matrix: ask IT to add one.");
  return out;
}

export function SetupWarningsCard({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <AlertCard id="setup-h" title="Setup to fix" count={lines.length} tone="act" icon={<UsersIcon size={15} />} data={{ "data-setup-warnings": "" }}
      link={{ href: "/admin/settings?open=branches", label: "Open Branches" }}>
      <ul>
        {lines.map((l) => <li key={l} className="border-b border-line-soft px-3 py-2 text-[14px] last:border-0 sm:px-4" data-setup-warning>{l}</li>)}
      </ul>
    </AlertCard>
  );
}
