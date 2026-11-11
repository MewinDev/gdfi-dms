import "server-only";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { isTestMode } from "@/lib/test-mode";
import { dataCheckSamples, sampleLoans, type SampleLoan } from "@/lib/myloans/samples";
import { inBranches, parseAmount } from "@/lib/myloans/data-check";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { SampleCard } from "@/components/loan/sample-loans";
import { peso } from "./plain";

function toCards(list: SampleLoan[], opened: Set<string>): SampleCard[] {
  return list.map((s) => {
    const amount = parseAmount(s.record?.totalReleasedAmount);
    return {
      pn: s.pn,
      tests: s.tests,
      name: s.record?.borrowerName || "Not in MyLoans",
      branch: s.record?.branchName ?? "No branch",
      product: s.record?.productName ?? "",
      loanType: s.record?.loanType ?? "-",
      amountText: amount === null ? "-" : peso(amount),
      opened: opened.has(s.pn),
    };
  });
}

/**
 * The three sample loans, only those the person can open: a sample in a branch outside their access
 * is left out (an Angono LA does not see the Antipolo sample). The search itself is unchanged.
 * The data-check samples are kept whole: some of them test the refusals, "outside your branches" too.
 */
export function samplesForUser(list: SampleLoan[], user: Pick<CurrentUser, "scopeBranchIds" | "branchNames" | "branchCodes">): SampleLoan[] {
  if (user.scopeBranchIds === null) return list;
  const allowed = user.branchNames.map((name, i) => ({ name, code: user.branchCodes[i] ?? null }));
  return list.filter((s) => s.record && inBranches({ branchCode: s.record.branchCode ?? null, branchName: s.record.branchName }, allowed));
}

/** Sample cards for the current user (empty when TEST_MODE is off). */
export async function loadSampleCards(user: Pick<CurrentUser, "scopeBranchIds" | "branchNames" | "branchCodes">): Promise<{ samples: SampleCard[]; dataCheck: SampleCard[] }> {
  const test = isTestMode();
  if (!test) return { samples: [], dataCheck: [] };
  const show = await getSetting("samples.showDataCheck");
  const s = samplesForUser(sampleLoans(test), user);
  const d = dataCheckSamples(test, show);
  const opened = new Set(
    (await prisma.loan.findMany({ where: { pn: { in: [...s, ...d].map((x) => x.pn) } }, select: { pn: true } })).map((l) => l.pn),
  );
  return { samples: toCards(s, opened), dataCheck: toCards(d, opened) };
}
