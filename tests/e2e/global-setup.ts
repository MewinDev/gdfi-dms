import { db, resetLoans } from "./db";

/** LOCAL DATABASE ONLY: start every run with no loan files. Each test also resets first. */
export default async function globalSetup() {
  await resetLoans();
  await db.$disconnect();
}
