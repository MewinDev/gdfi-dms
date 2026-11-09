/**
 * Part of npm run kit:start / kit:rebuild (scripts/kit.ts runs it): the clean kit (default) or, with
 * --with-scenarios, the old sample accounts and sample loans,
 * on a database that was just emptied, migrated and seeded. Not meant to be run by itself.
 */
import { loadEnvFiles } from "@/lib/env/load-files";
import { blankGraph } from "@/lib/kit/guard";

loadEnvFiles([".env.local", ".env"]);
blankGraph();

async function main() {
  const { prisma } = await import("@/lib/db");
  const log = (line: string) => console.log(`- ${line}`);
  try {
    if (process.argv.includes("--with-scenarios")) await (await import("@/lib/kit/build")).buildSamples(log);
    else await (await import("@/lib/kit/build-clean")).buildClean(log);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
