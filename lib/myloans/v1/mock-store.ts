import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { appEnv } from "@/lib/env";
import { getSetting } from "@/lib/settings";
import { mockRecords } from "@/lib/myloans/mock-data";
import { completeSample } from "@/lib/myloans/mock-account";
import { myLoansMode } from "@/lib/myloans/mode";
import type { MyLoansRecord } from "@/lib/myloans/types";
import type { MockBranchRow, MockData, MockProductRow, MockTxnRow } from "./mock-rows";
import { sampleBranchRows } from "@/lib/branches/kit-file";
import type { MyLoansBranchRow } from "@/lib/branches/file";
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
  // Never in the future: a sample "last changed at 5 PM" today is not a change seen this morning.
  const updated = new Date(Math.min(r.sourceUpdatedAt ? new Date(r.sourceUpdatedAt).getTime() : released, now.getTime() - 3_600_000));
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
  // Completed like a real answer (product code, area, division, company, status): lib/myloans/mock-account.ts.
  for (const r of [...mockRecords(now), ...extra]) all.set(r.pn, completeSample({ ...r, ...(overrides[r.pn] ?? {}) }));
  return [...all.values()].sort((a, b) => a.pn.localeCompare(b.pn));
}

const idOf = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

/** Fill the mock's tables from the sample loans. Safe to run again (nothing is duplicated). */
export async function seedMockFromSamples(db: Db = prisma, now: Date = new Date()): Promise<number> {
  const recs = await sampleRecords(db, now);
  const branches = new Map<string, MockBranchRow>();
  const products = new Map<string, MockProductRow>();
  // D-054: the branches are myloans' list with its real BranchIDs (the DMS keeps the same ids), keyed by code.
  for (const b of sampleBranchRows()) {
    branches.set(b.code, {
      branchId: b.branchId ?? 9000 + branches.size, branchCode: b.code, branchName: b.name, areaId: b.areaId, areaName: b.areaName || null, divisionId: b.divisionId, divisionName: b.divisionName || null,
      companyId: 1, companyName: "Global Dominion Financing Inc.", isActive: b.active ?? true, updatedAt: b.updatedAt ? new Date(b.updatedAt) : null,
    });
  }
  // The real product list first (D-049), so API 5 is myloans' list; sample loans use its ids by name.
  // Keyed by name and code: the samples may give one product name more than one code.
  for (const p of productsFromFile() ?? []) products.set(`${p.name.trim()}|${p.productCode}`, p);
  const nextId = () => Math.max(0, ...[...products.values()].map((p) => p.productId)) + 1;
  const branchIdOf = (r: MyLoansRecord) => {
    const key = r.branchCode ?? r.branchName ?? "?";
    if (!branches.has(key)) {
      const num = 9000 + branches.size; // a sample branch myloans' list does not have
      branches.set(key, {
        branchId: num, branchCode: r.branchCode, branchName: r.branchName ?? "Unknown branch", areaId: idOf(r.areaId), areaName: r.areaName ?? null, divisionId: idOf(r.divisionId), divisionName: r.divisionName ?? null,
        companyId: idOf(r.companyId) ?? 1, companyName: r.companyName ?? "Global Dominion Financing Inc.", isActive: true, updatedAt: null,
      });
    }
    return branches.get(key)!.branchId;
  };
  const productIdOf = (r: MyLoansRecord) => {
    const name = (r.productName ?? "").trim();
    if (!name) return null;
    const found = [...products.values()].find((p) => p.name === name && (!r.productCode || p.productCode === r.productCode));
    if (found) return found.productId;
    const id = nextId();
    const p = { productId: id, productCode: r.productCode ?? `P-${String(id).padStart(3, "0")}`, name, active: true };
    products.set(`${name}|${p.productCode}`, p);
    return id;
  };
  const txns = recs.map((r, i) => txnOfRecord(r, 1001 + i, branchIdOf(r), productIdOf(r), now));
  await db.mockMyLoansBranch.createMany({ data: [...branches.values()], skipDuplicates: true });
  await db.mockMyLoansProduct.createMany({ data: [...products.values()], skipDuplicates: true });
  await db.mockMyLoansTxn.createMany({ data: txns, skipDuplicates: true });
  return txns.length;
}

/** Everything the mock answers from (filled from the samples the first time), with the simulated changes on top. */
export async function loadMockData(db: Db = prisma): Promise<MockData> {
  if ((await db.mockMyLoansTxn.count()) === 0) await seedMockFromSamples(db);
  const [txns, products, rawBranches] = await Promise.all([db.mockMyLoansTxn.findMany(), db.mockMyLoansProduct.findMany(), db.mockMyLoansBranch.findMany()]);
  const branches = overlayBranches(rawBranches, await getSetting("myloans.mockBranches", db));
  return overlaySimulated({ txns, products, branches }, await getSetting("myloans.mockExtra", db), await getSetting("myloans.mockOverrides", db));
}

/**
 * The kit's and the tests' branch changes (Settings key myloans.mockBranches: a rename, a code change, a closed or a
 * new branch) on top of the mock's branch table, so API 4 and the loan feed say the same (D-054). Overrides are keyed by
 * BranchID, or by "code:<code>".
 */
export function overlayBranches(rows: MockBranchRow[], ch: { overrides: Record<string, Partial<MyLoansBranchRow> & { removed?: boolean }>; extra: MyLoansBranchRow[] }): MockBranchRow[] {
  const out = rows.map((b) => ({ ...b }));
  for (const e of ch.extra ?? []) {
    if (out.some((b) => b.branchId === e.branchId || b.branchCode === e.code)) continue;
    out.push({ branchId: e.branchId ?? 9500 + out.length, branchCode: e.code, branchName: e.name, areaId: e.areaId, areaName: e.areaName || null, divisionId: e.divisionId, divisionName: e.divisionName || null, companyId: 1, companyName: "Global Dominion Financing Inc.", isActive: e.active ?? true, updatedAt: e.updatedAt ? new Date(e.updatedAt) : null });
  }
  const kept: MockBranchRow[] = [];
  for (const b of out) {
    const o = ch.overrides?.[String(b.branchId)] ?? (b.branchCode ? ch.overrides?.[`code:${b.branchCode}`] : undefined);
    if (o?.removed) continue;
    kept.push(o ? {
      ...b, ...(o.code !== undefined ? { branchCode: o.code } : {}), ...(o.name !== undefined ? { branchName: o.name } : {}), ...(o.active !== undefined && o.active !== null ? { isActive: o.active } : {}),
      ...(o.areaId !== undefined ? { areaId: o.areaId } : {}), ...(o.areaName !== undefined ? { areaName: o.areaName } : {}), ...(o.divisionId !== undefined ? { divisionId: o.divisionId } : {}), ...(o.divisionName !== undefined ? { divisionName: o.divisionName } : {}),
      updatedAt: o.updatedAt ? new Date(o.updatedAt) : b.updatedAt,
    } : b);
  }
  return kept;
}

const STATUS_ID: Record<string, number> = { RELEASED: 12, CANCELLED: 14, REPLACED: 12, NOT_RELEASED: 10 };

/**
 * The simulator's changes (Settings, System, Simulate a MyLoans change; tests) on top of the mock's rows, in memory:
 * an extra loan becomes a row (a replacement keeps the old copy's CIN and marks the old copy replaced, as a redo does
 * in myloans), and a per-PN change sets the agreed fields and moves updated_at to when it changed.
 */
export function overlaySimulated(data: MockData, extra: MyLoansRecord[], overrides: Record<string, Partial<MyLoansRecord> & { changedAt?: string }>, now: Date = new Date()): MockData {
  const txns = data.txns.map((t) => ({ ...t }));
  const products = [...data.products];
  const branches = [...data.branches];
  const productId = (name: string | null | undefined) => {
    const n = (name ?? "").trim();
    if (!n) return null;
    const p = products.find((x) => x.name === n);
    if (p) return p.productId;
    const id = Math.max(0, ...products.map((x) => x.productId)) + 1;
    products.push({ productId: id, productCode: `P-SIM-${id}`, name: n, active: true });
    return id;
  };
  // D-054: a branch is found by its code in myloans' list (its real BranchID); an unknown code gets a new id.
  const branchId = (code: string | null | undefined, name: string | null | undefined) => {
    if (!code) return null;
    const found = branches.find((b) => b.branchCode === code);
    if (found) return found.branchId;
    const id = Math.max(9800, ...branches.map((b) => b.branchId)) + 1;
    branches.push({ branchId: id, branchCode: code, branchName: name ?? code, areaId: null, areaName: null, divisionId: null, divisionName: null, companyId: 1, companyName: null, isActive: true, updatedAt: null });
    return id;
  };
  let nextId = Math.max(800_000, ...txns.map((t) => t.id)) + 1;
  for (const r of extra) {
    if (txns.some((t) => t.pnNo === r.pn)) continue;
    const row = txnOfRecord(r, nextId++, branchId(r.branchCode, r.branchName) ?? 0, productId(r.productName), now);
    const old = r.previousPn ? txns.find((t) => t.pnNo === r.previousPn) : undefined;
    if (old) row.cin = old.cin;
    txns.push(row);
  }
  for (const [pn, o] of Object.entries(overrides)) {
    const t = txns.filter((x) => x.pnNo === pn).sort((a, b) => b.id - a.id)[0];
    if (!t) continue;
    if (o.changedAt) t.updatedAt = new Date(o.changedAt);
    if (o.totalReleasedAmount !== undefined && o.totalReleasedAmount !== null && Number.isFinite(Number(o.totalReleasedAmount))) t.amount = Number(o.totalReleasedAmount).toFixed(2);
    if (o.borrowerName !== undefined) {
      const parts = String(o.borrowerName ?? "").trim().split(/\s+/).filter(Boolean);
      t.firstName = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] ?? null;
      t.lastName = parts.length > 1 ? parts.at(-1)! : null;
      t.middleName = null;
      t.suffix = null;
    }
    if (o.cif !== undefined) t.cifNo = o.cif;
    if (o.cin !== undefined && o.cin !== null) t.cin = o.cin;
    if (o.loanType !== undefined) { t.loanType = o.loanType; t.loanTypeId = o.loanType ? LOAN_TYPE_ID[o.loanType] ?? o.loanType : null; }
    if (o.productName !== undefined) t.productId = productId(o.productName);
    if (o.productCode !== undefined && t.productId !== null) {
      const i = products.findIndex((x) => x.productId === t.productId);
      if (i >= 0) products[i] = { ...products[i], productCode: o.productCode ?? products[i].productCode };
    }
    if (o.releaseDate !== undefined) t.releaseDate = o.releaseDate ? new Date(`${o.releaseDate}T10:00:00+08:00`) : null;
    if (o.branchCode !== undefined || o.branchName !== undefined) t.branchId = branchId(o.branchCode ?? null, o.branchName ?? null) ?? t.branchId;
    if (o.isActive !== undefined && o.isActive !== null) t.isActive = o.isActive;
    if (o.statusId && /^\d+$/.test(o.statusId)) t.statusId = Number(o.statusId);
    else if (o.status && STATUS_ID[o.status] !== undefined) t.statusId = STATUS_ID[o.status];
    if (o.status === "REPLACED") {
      const rep = txns.find((x) => x.pnNo !== pn && extra.some((e) => e.pn === x.pnNo && e.previousPn === pn));
      if (rep) { t.replacedById = rep.id; rep.cin = t.cin; }
    }
    for (const k of ["areaName", "divisionName", "companyName"] as const) {
      if (o[k] !== undefined && t.branchId !== null) {
        const i = branches.findIndex((b) => b.branchId === t.branchId);
        if (i >= 0) branches[i] = { ...branches[i], [k]: o[k] ?? null };
      }
    }
  }
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
