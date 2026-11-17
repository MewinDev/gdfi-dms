import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Piece 6: the myloans mock's scenarios (fake data only: GD999 PNs, ids from 900000). Each button in Settings, Test
 * data adds one, following the round 3 contract (lib/myloans/r2). Times are "now", so API 2 sees them as changed.
 */
export const MOCK_SCENARIOS = {
  cancelRedo: "Cancel, then redo (the old copy Cancelled, a new copy with the same CIN)",
  redoNoCancel: "Redo without a cancellation (seen through the code's time suffix)",
  chain3: "Redo chain of 3 copies on one CIN",
  notReleased: "A released loan whose status left Released (NotReleased)",
  duplicate: "A loan sent twice in one run (duplicate row)",
  api1Conflict: "Two records for one PN # (API 1 answers 409)",
  exactly500: "Exactly 500 changed loans (a full page, then an empty one)",
  pool501: "501 released loans for the pool mode (two pages)",
  productRename: "A product renamed",
  branchRename: "A branch renamed",
  timestampOnly: "A timestamp-only change (same hash)",
} as const;
export type MockScenario = keyof typeof MOCK_SCENARIOS;

const pnOf = (n: number) => `GD99920269${String(n).padStart(5, "0")}`;
const codeOf = (id: number) => `TXN-FAKE-${String(id).padStart(11, "0")}`;
/** The redo suffix myloans adds to the code: "x" + Manila yyyymmddhhmmss. */
const suffix = (d: Date) => `x${new Date(d.getTime() + 8 * 3_600_000).toISOString().replace(/\D/g, "").slice(0, 14)}`;

async function nextId(): Promise<number> {
  const max = await prisma.mockMyLoansTxn.aggregate({ _max: { id: true }, where: { id: { gte: 900_000 } } });
  return Math.max(900_000, (max._max.id ?? 899_999) + 1);
}

function row(id: number, extra: Partial<Prisma.MockMyLoansTxnCreateManyInput> = {}, now = new Date()): Prisma.MockMyLoansTxnCreateManyInput {
  return {
    id, cin: `CIN-FAKE-${id}`, pnNo: pnOf(id % 100_000), statusId: 12, isActive: true, code: codeOf(id), updatedAt: now, createdAt: now,
    releaseDate: new Date(now.getTime() - 2 * 86_400_000), amount: "250000.00", cifNo: `CIF-FAKE-${id}`, firstName: "Fake", lastName: `Borrower ${id}`,
    loanId: String(id), loanTypeId: "1", loanType: "New", productId: 1, branchId: 165, source: "scenario", ...extra,
  };
}

/** Adds one scenario to the mock. Returns a line saying what was added. */
export async function addMockScenario(s: MockScenario, now: Date = new Date()): Promise<string> {
  const id = await nextId();
  const earlier = new Date(now.getTime() - 3_600_000);
  switch (s) {
    case "cancelRedo": {
      // The old copy is cancelled and later suffixed (Cancelled outranks Superseded); the new copy keeps the CIN.
      await prisma.mockMyLoansTxn.createMany({ data: [
        row(id, { cin: `CIN-FAKE-CR${id}`, statusId: 14, code: `${codeOf(id)}${suffix(now)}`, replacedById: id + 1, updatedAt: earlier, createdAt: earlier }, now),
        row(id + 1, { cin: `CIN-FAKE-CR${id}` }, now),
      ] });
      return `Cancelled ${pnOf(id % 100_000)}, redone as ${pnOf((id + 1) % 100_000)} (same CIN).`;
    }
    case "redoNoCancel": {
      await prisma.mockMyLoansTxn.createMany({ data: [
        row(id, { cin: `CIN-FAKE-RD${id}`, code: `${codeOf(id)}${suffix(now)}`, replacedById: id + 1, updatedAt: earlier, createdAt: earlier }, now),
        row(id + 1, { cin: `CIN-FAKE-RD${id}`, updatedAt: earlier, createdAt: earlier }, now),
      ] });
      return `${pnOf(id % 100_000)} redone as ${pnOf((id + 1) % 100_000)} without a cancellation.`;
    }
    case "chain3": {
      const cin = `CIN-FAKE-CH${id}`;
      await prisma.mockMyLoansTxn.createMany({ data: [
        row(id, { cin, code: `${codeOf(id)}${suffix(earlier)}`, replacedById: id + 2, updatedAt: earlier, createdAt: earlier }, now),
        row(id + 1, { cin, code: `${codeOf(id + 1)}${suffix(now)}`, replacedById: id + 2, updatedAt: earlier, createdAt: earlier }, now),
        row(id + 2, { cin }, now),
      ] });
      return `Redo chain on ${cin}: ${pnOf(id % 100_000)} → ${pnOf((id + 1) % 100_000)} → ${pnOf((id + 2) % 100_000)} (live).`;
    }
    case "notReleased":
      await prisma.mockMyLoansTxn.createMany({ data: [row(id, { statusId: 18 }, now)] });
      return `${pnOf(id % 100_000)}: released once, now NotReleased.`;
    case "duplicate":
      await prisma.mockMyLoansTxn.createMany({ data: [row(id, { duplicate: true }, now)] });
      return `${pnOf(id % 100_000)} comes back twice in one run.`;
    case "api1Conflict":
      await prisma.mockMyLoansTxn.createMany({ data: [row(id, { pnNo: pnOf(99_000 + (id % 1000)) }, now), row(id + 1, { pnNo: pnOf(99_000 + (id % 1000)), statusId: 14 }, now)] });
      return `${pnOf(99_000 + (id % 1000))} has two records (API 1 answers 409).`;
    case "exactly500":
    case "pool501": {
      const n = s === "exactly500" ? 500 : 501;
      await prisma.mockMyLoansTxn.createMany({ data: Array.from({ length: n }, (_, i) => row(id + i, {}, now)) });
      return `${n} released loans added (${pnOf(id % 100_000)} and on).`;
    }
    case "productRename": {
      const p = await prisma.mockMyLoansProduct.findFirst({ orderBy: { productId: "asc" } });
      if (!p) return "No product to rename.";
      const name = p.name.includes("Refinancing") ? p.name.replace("Refinancing", "Financing") : `${p.name.replace(/Financing|Loan/, "").trim()} Refinancing`.trim();
      await prisma.mockMyLoansProduct.update({ where: { productId: p.productId }, data: { name } });
      return `Product ${p.productCode} renamed from "${p.name}" to "${name}".`;
    }
    case "branchRename": {
      const b = await prisma.mockMyLoansBranch.findFirst({ orderBy: { branchId: "asc" } });
      if (!b) return "No branch to rename.";
      const name = b.branchName.endsWith(" (renamed)") ? b.branchName.replace(" (renamed)", "") : `${b.branchName} (renamed)`;
      await prisma.mockMyLoansBranch.update({ where: { branchId: b.branchId }, data: { branchName: name, updatedAt: now } });
      return `Branch ${b.branchCode ?? b.branchId} renamed to "${name}".`;
    }
    case "timestampOnly": {
      const t = await prisma.mockMyLoansTxn.findFirst({ where: { statusId: 12, replacedById: null }, orderBy: { id: "asc" } });
      if (!t) return "No loan to touch.";
      await prisma.mockMyLoansTxn.update({ where: { id: t.id }, data: { updatedAt: now } });
      return `${t.pnNo}: only its time changed (the hash is the same).`;
    }
  }
}
