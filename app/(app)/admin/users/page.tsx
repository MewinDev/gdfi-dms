import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { inactiveEffect } from "@/lib/services/settings-status";
import { PageHeader } from "@/components/ui/basics";
import { UserEditForm } from "@/components/admin/forms";
import { SettingsModal } from "@/components/admin/settings-modal";
import { ImportStep } from "@/components/admin/import-step";
import { UsersToolbar } from "@/components/admin/users-toolbar";
import { shortRoleName } from "@/lib/ui/roles";
import { can } from "@/lib/auth/current-user";
import { permissionLabel, plainWords } from "@/lib/auth/permissions";
import { effectivePermissions } from "@/lib/auth/access";
import { accessTreeData } from "@/lib/services/access";
import { accessSummary } from "@/lib/branches/access";

export const metadata: Metadata = { title: "Users" };

type SP = { q?: string; role?: string; branch?: string; status?: string; open?: string; edit?: string };

const MAX_BRANCH_CHIPS = 2;

export default async function UsersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePagePermission(PERMISSIONS.USERS_VIEW);
  const sp = await searchParams;
  const canEdit = can(me, PERMISSIONS.USERS_EDIT);
  const canManageRoles = can(me, PERMISSIONS.ROLES_MANAGE);
  const status = sp.status === "inactive" || sp.status === "all" ? sp.status : "active";
  const q = (sp.q ?? "").trim();

  const where: Prisma.UserWhereInput = {
    ...(status === "all" ? {} : { active: status === "active" }),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    ...(sp.role ? { roleId: sp.role } : {}),
    // Who works at this branch: their access includes it, or they have All branches.
    ...(sp.branch ? { AND: [{ OR: [{ branches: { some: { branchId: sp.branch } } }, { allBranches: true }] }] } : {}),
  };
  const [users, roles, branches, total] = await Promise.all([
    prisma.user.findMany({ where, include: { role: true, accessGrants: true, homeBranch: true, branches: { include: { branch: true }, orderBy: { branch: { name: "asc" } } } }, orderBy: [{ role: { sortOrder: "asc" } }, { name: "asc" }] }),
    prisma.role.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.branch.findMany({ where: { hidden: false }, orderBy: { name: "asc" } }),
    prisma.user.count(),
  ]);

  // Addresses keep the filters, so closing a pop-up returns to the same list.
  const keep = new URLSearchParams();
  for (const k of ["q", "role", "branch", "status"] as const) if (sp[k]) keep.set(k, sp[k]!);
  const listHref = `/admin/users${keep.size ? `?${keep}` : ""}`;
  const withOpen = (open: string, edit?: string) => {
    const p = new URLSearchParams(keep);
    p.set("open", open);
    if (edit) p.set("edit", edit);
    return `/admin/users?${p}`;
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title="Users" help="Who can use the system, their role and their branches. Nothing is deleted: make a user inactive instead.">
        <div className="flex flex-wrap gap-2">
          <Link id="users-roles" href={withOpen("roles")} scroll={false} aria-haspopup="dialog" className="btn-ghost">What each role can do</Link>
          {canManageRoles && <Link href="/admin/settings?open=roles" className="btn-ghost">Manage roles</Link>}
          {canEdit && can(me, PERMISSIONS.SETTINGS_IMPORT) && <Link id="users-import" href={withOpen("import")} scroll={false} aria-haspopup="dialog" className="btn-ghost">Import / Export</Link>}
        </div>
      </PageHeader>

      <UsersToolbar
        q={q} role={sp.role ?? ""} branch={sp.branch ?? ""} status={status}
        roles={roles.map((r) => ({ key: r.id, name: `${shortRoleName(r.name)}${r.active ? "" : " (inactive)"}` }))}
        branches={branches.map((b) => ({ id: b.id, name: `${b.name}${b.active ? "" : " (inactive)"}` }))}
        addHref={canEdit ? withOpen("user", "new") : undefined}
      />

      <p className="-mb-3 text-sm text-ink-2" role="status">{users.length} of {total} user{total === 1 ? "" : "s"}</p>

      {users.length === 0 ? (
        <p className="card p-6 text-[15px] text-ink-2">No users match. Change the search or the filters.</p>
      ) : (
        <>
          {/* Tablet and desktop: a tidy table */}
          <div className="card hidden overflow-x-auto sm:block">
            <table className="table" aria-label="Users">
              <thead>
                <tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Branches</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Edit</span></th></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.active ? "" : "text-ink-2"}>
                    <td className="min-w-48">
                      <span className={`block font-semibold ${u.active ? "text-navy" : "text-ink-2"}`}>{u.name}</span>
                      <span className="block text-sm text-ink-2">{u.email}</span>
                    </td>
                    <td className="min-w-44"><RoleCell role={u.role} /></td>
                    <td className="min-w-40"><AccessCell u={u} /></td>
                    <td><StatusCell active={u.active} test={u.isTestUser} /></td>
                    <td className="text-right">
                      {canEdit && <Link id={`edit-${u.id}`} href={withOpen("user", u.id)} scroll={false} aria-haspopup="dialog" aria-label={`Edit ${u.name}`} className="btn-ghost btn-sm">Edit</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone: stacked cards */}
          <ul className="flex flex-col gap-3 sm:hidden" aria-label="Users">
            {users.map((u) => (
              <li key={u.id} className={`card flex flex-col gap-2.5 p-4 ${u.active ? "" : "bg-fill-soft"}`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={`font-semibold ${u.active ? "text-navy" : "text-ink-2"}`}>{u.name}</p>
                    <p className="break-all text-sm text-ink-2">{u.email}</p>
                  </div>
                  {canEdit && <Link id={`edit-m-${u.id}`} href={withOpen("user", u.id)} scroll={false} aria-haspopup="dialog" aria-label={`Edit ${u.name}`} className="btn-ghost btn-sm shrink-0">Edit</Link>}
                </div>
                <RoleCell role={u.role} />
                <AccessCell u={u} />
                <StatusCell active={u.active} test={u.isTestUser} />
              </li>
            ))}
          </ul>
        </>
      )}

      {sp.open && (sp.open === "roles" || canEdit) && <UsersModal sp={sp} meId={me.id} canAccess={can(me, PERMISSIONS.ACCESS_MANAGE)} listHref={listHref} roles={roles} canManageRoles={canManageRoles} />}
    </div>
  );
}

function RoleCell({ role }: { role: { name: string; canSignIn: boolean } }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="chip c-navy h-6 whitespace-nowrap text-xs" title={role.name}>{shortRoleName(role.name)}</span>
      {!role.canSignIn && <span className="chip c-mute h-6 whitespace-nowrap text-xs">Not signed in yet</span>}
    </span>
  );
}

/** "All branches", or the branches as chips, with the access summary when areas or divisions are granted. */
function AccessCell({ u }: { u: { allBranches: boolean; role: { key: string; builtIn: boolean }; accessGrants: { kind: "DIVISION" | "AREA" | "BRANCH"; divisionId: string | null; areaId: string | null; branchId: string | null; exclude: boolean }[]; branches: { branch: { name: string } }[]; homeBranch: { name: string } | null } }) {
  if (u.allBranches) return <span className="chip c-navy h-6 whitespace-nowrap text-xs">All branches</span>;
  const groups = u.accessGrants.some((g) => g.kind !== "BRANCH");
  return (
    <span className="flex flex-col items-start gap-1">
      {groups ? <span className="text-sm">{accessSummary(u.accessGrants, u.branches.length, false)}</span> : <BranchChips names={u.branches.map((b) => b.branch.name)} />}
      {u.homeBranch && <span className="text-xs text-ink-2">Home: {u.homeBranch.name}</span>}
    </span>
  );
}

function BranchChips({ names }: { names: string[] }) {
  if (names.length === 0) return <span className="text-sm text-ink-2">No branch</span>;
  const shown = names.slice(0, MAX_BRANCH_CHIPS);
  const more = names.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1.5" title={names.join(", ")}>
      {shown.map((n) => <span key={n} className="chip c-mute h-6 whitespace-nowrap text-xs">{n}</span>)}
      {more > 0 && <span className="chip h-6 whitespace-nowrap border border-line text-xs">+{more} more</span>}
    </span>
  );
}

function StatusCell({ active, test }: { active: boolean; test: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {active ? <span className="chip c-ok h-6 text-xs">Active</span> : <span className="chip c-mute h-6 text-xs">Inactive</span>}
      {test && <span className="rounded border border-line px-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">Test</span>}
    </span>
  );
}

async function UsersModal({
  sp, meId, listHref, roles, canManageRoles, canAccess,
}: {
  sp: SP;
  meId: string;
  /** Change branch access (access:manage): otherwise the access is shown read only and not sent. */
  canAccess: boolean;
  listHref: string;
  canManageRoles: boolean;
  roles: { id: string; key: string; name: string; description: string; canSignIn: boolean; builtIn: boolean; active: boolean; branchAccess: "ASSIGNED" | "ALL"; permissions: string[] }[];
}) {
  if (sp.open === "roles") {
    return (
      <SettingsModal id="settings-modal" title="What each role can do" help={canManageRoles ? "Read-only here. Change roles in Settings > Roles and access." : "Read-only. Ask an Admin to change a role."} closeHref={listHref} returnFocusId="users-roles" footer={{ kind: "done" }}>
        <ul className="flex flex-col gap-3">
          {roles.filter((r) => r.active).map((r) => (
            <li key={r.id} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-bold text-navy">{r.name}</span>
                <span className={`chip h-6 text-xs ${r.builtIn ? "c-navy" : "c-act"}`}>{r.builtIn ? "Built-in" : "Custom"}</span>
                {r.canSignIn ? <span className="chip c-ok h-6 text-xs">Can sign in</span> : !r.builtIn ? <span className="chip c-mute h-6 text-xs">Test users in test mode</span> : <span className="chip c-mute h-6 text-xs">Not signed in yet</span>}
              </div>
              {r.description && <p className="mt-1 text-sm">{r.description}</p>}
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
                {plainWords(effectivePermissions(r), r.branchAccess).map((w) => <li key={w}>{w}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      </SettingsModal>
    );
  }
  if (sp.open === "import") {
    return (
      <SettingsModal id="settings-modal" title="Users: Import / Export" help="Download a file, fill it in Excel, then check and import it. Import never sets passwords or sign-in." closeHref={listHref} backHref={listHref} returnFocusId="users-import" footer={{ kind: "done" }}>
        <ImportStep list="users" />
      </SettingsModal>
    );
  }
  if (sp.open !== "user" || !sp.edit) return null;

  const isNew = sp.edit === "new";
  const u = isNew ? null : await prisma.user.findUnique({ where: { id: sp.edit }, include: { accessGrants: true, role: true } });
  if (!isNew && !u) return null;
  // Active roles only; an inactive role already on this user is shown with an "Inactive" tag.
  const roleOpts = roles
    .filter((r) => r.active || r.id === u?.roleId)
    .map((r) => ({ id: r.id, name: r.name, canSignIn: r.canSignIn, builtIn: r.builtIn, active: r.active, permissions: [...effectivePermissions(r)].map(permissionLabel), admin: false, allByDefault: r.branchAccess === "ALL" }));
  const tree = await accessTreeData();
  // A new user starts with the default of the first role offered (All for roles whose default is All).
  const firstRole = roles.find((r) => r.active && r.canSignIn);
  const initial = u
    ? { all: u.allBranches, grants: u.accessGrants.map((g) => ({ kind: g.kind, divisionId: g.divisionId, areaId: g.areaId, branchId: g.branchId, exclude: g.exclude })), homeBranchId: u.homeBranchId }
    : { all: firstRole?.branchAccess === "ALL", grants: [], homeBranchId: null };
  const homeName = u?.homeBranchId ? (await prisma.branch.findUnique({ where: { id: u.homeBranchId }, select: { name: true, code: true } })) : null;
  const readOnlyAccess = canAccess ? undefined : u
    ? `${accessSummary(initial.grants, await prisma.userBranch.count({ where: { userId: u.id } }), initial.all)}${homeName ? ` · home branch ${homeName.name}` : ""}`
    : "The role's default: All branches when the role is set to All, otherwise none yet. Someone who may change branch access sets it.";
  return (
    <SettingsModal
      id="settings-modal"
      title={isNew ? "Add user" : `Edit ${u!.name}`}
      help={isNew ? "New users start as test users. Built-in roles that may sign in: Admin and Loan Associate. Custom roles: test users in test mode." : "Change the name, role, branch access or status."}
      closeHref={listHref}
      returnFocusId={isNew ? "users-add" : `edit-${u!.id}`}
      footer={{ kind: "save", formId: "user-form", cancelHref: listHref }}
    >
      <UserEditForm
        key={sp.edit}
        formId="user-form"
        listHref={listHref}
        user={u ? { id: u.id, name: u.name, email: u.email, roleId: u.roleId, active: u.active } : null}
        roles={roleOpts}
        access={{ ...tree, initial, readOnlySummary: readOnlyAccess }}
        effect={u ? await inactiveEffect("user", u.id) : ""}
      />
      {u && u.id === meId && <p className="mt-4 text-sm text-ink-2">This is you. You cannot make yourself inactive.</p>}
    </SettingsModal>
  );
}
