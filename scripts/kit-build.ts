/**
 * Part of npm run kit:start / kit:rebuild (scripts/kit.ts runs it): the sample accounts and sample loans,
 * on a database that was just emptied, migrated and seeded. Not meant to be run by itself.
 */
import { loadEnvFiles } from "@/lib/env/load-files";
import { blankGraph } from "@/lib/kit/guard";

loadEnvFiles([".env.local", ".env"]);
blankGraph();

async function main() {
  const { buildSamples } = await import("@/lib/kit/build");
  const { prisma } = await import("@/lib/db");
  try {
    await buildSamples((line) => console.log(`- ${line}`));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
