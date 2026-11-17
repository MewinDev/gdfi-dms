// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { noBranchesText, setUserBranches, usersWithoutBranches } from "@/lib/services/access";
import { setupWarnings } from "@/components/home/setup-warnings";

/**
 * "N users have no branches assigned (they see nothing)": on Users and on the Superadmin's Home, like the
 * approver and CA / FT warnings. Counts active people who are not All branches and have no branch.
 */
const E = (k: string) => `zz.nobranch.${k}@gdfi.ph`;
const clean = () => prisma.user.deleteMany({ where: { email: { startsWith: "zz.nobranch." } } });

beforeAll(async () => {
  await clean();
  const la = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
  const angono = await prisma.branch.findUniqueOrThrow({ where: { code: "165" } });
  const mk = (k: string, extra: Record<string, unknown> = {}) => prisma.user.create({ data: { email: E(k), name: `Zz Nobranch ${k}`, roleId: la.id, isTestUser: true, ...extra } });
  await mk("none");
  await mk("inactive", { active: false });
  await mk("all", { allBranches: true });
  await setUserBranches((await mk("one")).id, [angono.id]);
});
afterAll(clean);

describe("users with no branches", () => {
  it("counts only active people without All branches and without any branch", async () => {
    const names = (await usersWithoutBranches()).map((u) => u.name).filter((n) => n.startsWith("Zz Nobranch"));
    expect(names).toEqual(["Zz Nobranch none"]);
  });

  it("plain words, singular and plural", () => {
    expect(noBranchesText(1)).toBe("1 user has no branches assigned (they see nothing).");
    expect(noBranchesText(3)).toBe("3 users have no branches assigned (they see nothing).");
  });

  it("is on the Superadmin's Home setup warnings, with the names and what to do", async () => {
    const n = (await usersWithoutBranches()).length;
    const line = (await setupWarnings()).find((l) => l.includes("no branches assigned"));
    expect(line).toContain(noBranchesText(n));
    expect(line).toContain("Users, Edit");
  });
});
