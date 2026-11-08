import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Prisma client singleton. SSL is controlled only by the connection string (e.g. `sslmode=require`
 * for Supabase), so the local Docker database (no SSL) and Supabase (SSL) both connect unchanged.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Tests only: count the statements sent to the database (to prove a sync run stays bounded). */
export const queryCounter = { count: 0 };
const counting = !!process.env.VITEST;

function makeClient() {
  if (!counting) return new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
  const c = new PrismaClient({ log: [{ emit: "event", level: "query" }, { emit: "stdout", level: "error" }] });
  c.$on("query", () => { queryCounter.count++; });
  return c;
}

export const prisma = globalForPrisma.prisma ?? (makeClient() as PrismaClient);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;

/**
 * Runs `fn` in one database transaction. When `loanId` is given the Loan row is locked
 * (SELECT ... FOR UPDATE) first, so concurrent writes to the same Loan File are serialized.
 */
export async function withLoanLock<T>(loanId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      if (loanId) {
        await tx.$queryRaw`SELECT id FROM "Loan" WHERE id = ${loanId} FOR UPDATE`;
      }
      return fn(tx);
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

export { Prisma };
