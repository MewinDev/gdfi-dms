import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInWith, type TestUser } from "./helpers";

/**
 * D-058: an automated accessibility check (axe-core 4.14, WCAG 2.1 A and AA rules) on the main screens of each
 * phase A role, at every width the run uses (1440, 820, 390), with the phone drawer open as well. Any violation
 * fails the test; the message lists the rule, the impact and the first elements it found.
 */
const AXE = path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js");

type Result = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] };

async function axe(page: Page, where: string) {
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (ctx: unknown, o: unknown) => Promise<{ violations: Result[] }> } };
    const r = await w.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target as string[] })) }));
  });
  expect(violations, `${where}: ${violations.map((v) => `${v.id} (${v.impact}): ${v.help} at ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`).join("\n")}`).toEqual([]);
}

const SCREENS: { role: string; who: TestUser; pages: string[] }[] = [
  { role: "Loan Associate", who: "Continue as Loan Associate", pages: ["/dashboard", "/loans", "/inbox", "/inbox?tab=pool"] },
  { role: "Document Processor", who: "Continue as Test Document Processor", pages: ["/jobs", "/my-funds"] },
  { role: "Finance", who: "Continue as Test Finance", pages: ["/funds"] },
  { role: "Admin", who: "Continue as Admin", pages: ["/open-items", "/loans", "/admin/users"] },
];

for (const s of SCREENS) {
  test(`axe: ${s.role} main screens`, async ({ page }) => {
    test.setTimeout(240_000);
    await signInWith(page, s.who);
    for (const p of s.pages) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      await axe(page, `${s.role} ${p} at ${page.viewportSize()!.width}px`);
    }
  });
}

test("axe: the phone drawer, open", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "The drawer is the phone's menu.");
  await signInWith(page, "Continue as Loan Associate");
  await page.goto("/loans");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await axe(page, "drawer open");
});
