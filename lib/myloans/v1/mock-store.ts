import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { appEnv } from "@/lib/env";
import { getSetting } from "@/lib/settings";
import { mockRecords } from "@/lib/myloans/mock-data";
import { myLoansMode } from "@/lib/myloans";
import type { MyLoansRecord } from "@/lib/myloans/types";
import type { MockBranchRow, MockData, MockProductRow, MockTxnRow } from "./mock-rows";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseProductsTsv, PRODUCTS_FILE } from "./products-file";

/** D-049: myloans' real product list (PR_PRODUCTS export), when the file is in the repo. */
export function productsFromFile(root = process.cwd()): MockProductRow[] | null {
  const f = path.join(root, PRODUCTS_FILE);
  if (!existsSync(f)) return null;
  const r = parseProductsTsv(readFileSync(f, "utf8"));
  return r.problem ? null : r.rows.map((x) => ({ productId: x.productId, productCode: x.productCode, name: x.name, active: x.active }));
}

/**
 * Piece 6 (D-047, D-048): the myloans mock's own data (tables MockMyLoansTxn, MockMyLoansProduct, MockMyLoansBranch).
 * Only while MYLOANS_MODE=mock on local or staging; never in production. When empty it is filled from the sample loans
 * (the built-in samples and the Manual Test Kit's PNs), so the mock answers for every PN the kit lists.
 */
export function mockAllowed(): boolean {
  return appEnv() !== "production" && myLoansMode() === "mock";
}

type Db = Tx | typeof prisma;
const LOAN_TYPE_ID: Record<string, string> = { New: "1", Renewal: "2" };

/** A sample record (the shape the screens use today) as a myloans transaction row. */
function txnOfRecord(r: MyLoansRecord, id: number, branchId: number, productId: number | null, now: Date): Omit<MockTxnRow, "id"> & { id: number; source: string } {
  const parts = (r.borrowerName ?? "").trim().split(/\s+/).filter(Boolean);
  const amount = r.totalReleasedAmount === null || r.totalReleasedAmount === "" || Number.isNaN(Number(r.totalReleasedAmount)) ? null : Number(r.totalReleasedAmount).toFixed(2);
  const statusId = r.statusId && /^\d+$/.test(r.statusId) ? Number(r.statusId) : r.status === "CANCELLED" ? 14 : r.status === "RELEASED" || r.status === null ? 12 : 10;
  // Last changed when it was released (or its recorded time): a sample is not "changed" just because the mock was filled.
  const released = r.releaseDate ? new Date(`${r.releaseDate}T10:00:00+08:00`).getTime() : now.getTime() - 30 * 86_400_000;
  const updated = r.sourceUpdatedAt ? new Date(r.sourceUpdatedAt) : new Date(Math.min(released, now.getTime() - 3_600_000));
  return {
    id, cin: r.cin ?? `CIN-${r.pn}`.slice(0, 20), pnNo: r.pn, statusId, isActive: r.isActive ?? true, code: `TXN-${r.pn}`.slice(0, 20),
    updatedAt: updated, createdAt: updated, replacedById: null, duplicate: false,
    releaseDate: r.releaseDate ? new Date(`${r.releaseDate}T10:00:00+08:00`) : null, amount,
    cifNo: r.cif, firstName: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] ?? null, middleName: null, lastName: parts.length > 1 ? parts.at(-1)! : null, suffix: null,
    loanId: r.sourceLoanId, loanTypeId: r.loanType ? LOAN_TYPE_ID[r.loanType] ?? r.loanType : null, loanType: r.loanType, borrowerCompanyName: null,
    productId, branchId, source: "samples",
  };
}

/** The samples the mock starts from: the built-in ones and the kit's PNs, with any simulated change applied. */
async function sampleRecords(db: Db, now: Date): Promise<MyLoansRecord[]> {
  const [extra, overrides] = await Promise.all([getSetting("myloans.mockExtra", db), getSetting("myloans.mockOverrides", db)]);
  const all = new Map<string, MyLoansRecord>();
  for (const r of [...mockRecords(now), ...extra]) all.set(r.pn, { ...r, ...(overrides[r.pn] ?? {}) });
  return [...all.values()].sort((a, b) => a.pn.localeCompare(b.pn));
}

/** Fill the mock's tables from the sample loans. Safe to run again (nothing is duplicated). */
export async function seedMockFromSamples(db: Db = prisma, now: Date = new Date()): Promise<number> {
  const recs = await sampleRecords(db, now);
  const branches = new Map<string, MockBranchRow>();
  const products = new Map<string, MockProductRow>();
  // The real product list first (D-049), so API 5 is myloans' list; sample loans use its ids by name.
  for (const p of productsFromFile() ?? []) products.set(p.name.trim(), p);
  const nextId = () => Math.max(0, ...[...products.values()].map((p) => p.productId)) + 1;
  const branchIdOf = (r: MyLoansRecord) => {
    const key = r.branchCode ?? r.branchName ?? "?";
    if (!branches.has(key)) {
      const num = r.branchCode && /^\d+$/.test(r.branchCode) ? Number(r.branchCode) : 9000 + branches.size;
      branches.set(key, {
        branchId: num, branchCode: r.branchCode, branchName: r.branchName ?? "Unknown branch", areaId: null, areaName: r.areaName ?? null, divisionId: null, divisionName: r.divisionName ?? null,
        companyId: 1, companyName: r.companyName ?? "Global Dominion Financing Inc.", isActive: true, updatedAt: null,
      });
    }
    return branches.get(key)!.branchId;
  };
  const productIdOf = (r: MyLoansRecord) => {
    const name = (r.productName ?? "").trim();
    if (!name) return null;
    if (!products.has(name)) { const id = nextId(); products.set(name, { productId: id, productCode: r.productCode ?? `P-${String(id).padStart(3, "0")}`, name, active: true }); }
    return products.get(name)!.productId;
  };
  const txns = recs.map((r, i) => txnOfRecord(r, 1001 + i, branchIdOf(r), productIdOf(r), now));
  await db.mockMyLoansBranch.createMany({ data: [...branches.values()], skipDuplicates: true });
  await db.mockMyLoansProduct.createMany({ data: [...products.values()], skipDuplicates: true });
  await db.mockMyLoansTxn.createMany({ data: txns, skipDuplicates: true });
  return txns.length;
}

/** Everything the mock answers from (filled from the samples the first time). */
export async function loadMockData(db: Db = prisma): Promise<MockData> {
  if ((await db.mockMyLoansTxn.count()) === 0) await seedMockFromSamples(db);
  const [txns, products, branches] = await Promise.all([db.mockMyLoansTxn.findMany(), db.mockMyLoansProduct.findMany(), db.mockMyLoansBranch.findMany()]);
  return { txns, products, branches };
}

/** Empty the mock and fill it again from the samples (Settings, Test data, "Reset the mock data"). */
export async function resetMockData(db: typeof prisma = prisma): Promise<number> {
  return db.$transaction(async (tx) => {
    await tx.mockMyLoansTxn.deleteMany({});
    await tx.mockMyLoansProduct.deleteMany({});
    await tx.mockMyLoansBranch.deleteMany({});
    return seedMockFromSamples(tx);
  }, { timeout: 60_000 });
}
