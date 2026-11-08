"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { SearchIcon } from "@/components/ui/icons";

/**
 * Users: search (name or email), Role, Branch and Status filters, and Add user. The filters live
 * in the address (?q=&role=&branch=&status=), so refresh, Back and links keep them.
 */
export function UsersToolbar({
  q, role, branch, status, roles, branches, addHref,
}: {
  q: string;
  role: string;
  branch: string;
  status: string;
  roles: { key: string; name: string }[];
  branches: { id: string; name: string }[];
  /** Shown only to people who may add users. */
  addHref?: string;
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const go = () => {
    const fd = new FormData(form.current!);
    const p = new URLSearchParams();
    for (const [k, v] of fd.entries()) if (String(v) && !(k === "status" && v === "active")) p.set(k, String(v));
    router.push(`/admin/users${p.size ? `?${p}` : ""}`, { scroll: false });
  };
  return (
    <form ref={form} role="search" aria-label="Find users" onSubmit={(e) => { e.preventDefault(); go(); }} className="flex flex-col gap-3 lg:flex-row lg:items-end">
      <div className="min-w-0 flex-1">
        <label htmlFor="users-q" className="label">Search</label>
        <div className="flex h-[46px] items-center gap-2.5 rounded-xl border border-line-input bg-white px-4 focus-within:border-navy">
          <span className="text-ink-2"><SearchIcon size={18} /></span>
          <input id="users-q" name="q" defaultValue={q} placeholder="Name or email" autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-2 focus-visible:outline-none" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 lg:flex">
        <div className="min-w-0 lg:w-48">
          <label htmlFor="users-role" className="label">Role</label>
          <select id="users-role" name="role" defaultValue={role} onChange={go} className="input">
            <option value="">All roles</option>
            {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </div>
        <div className="min-w-0 lg:w-40">
          <label htmlFor="users-branch" className="label">Branch</label>
          <select id="users-branch" name="branch" defaultValue={branch} onChange={go} className="input">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="min-w-0 lg:w-36">
          <label htmlFor="users-status" className="label">Status</label>
          <select id="users-status" name="status" defaultValue={status} onChange={go} className="input">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>
      <div className="flex gap-3">
        <button type="submit" className="btn-ghost flex-1 lg:flex-none">Search</button>
        {addHref && <Link id="users-add" href={addHref} scroll={false} aria-haspopup="dialog" className="btn-gold flex-1 lg:flex-none">Add user</Link>}
      </div>
    </form>
  );
}
