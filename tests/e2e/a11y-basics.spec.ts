import { expect, test, type Page } from "@playwright/test";
import { signInWith, SUPERADMIN, type TestUser } from "./helpers";

/**
 * Accessibility and phone-width basics (piece 12, D-055), on the main screens of each phase A role, at every width
 * the run uses: the page language, one main heading, every button and link has a name, every form field has a label,
 * images have alt text, and nothing scrolls sideways. Not a full audit; it catches the common slips.
 */
async function basics(page: Page, where: string) {
  const r = await page.evaluate(() => {
    const visible = (e: Element) => { const b = (e as HTMLElement).getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
    const named = (e: Element) => {
      const t = (e.getAttribute("aria-label") ?? "").trim() || (e.textContent ?? "").trim() || (e.getAttribute("title") ?? "").trim();
      const by = e.getAttribute("aria-labelledby");
      const img = e.querySelector("img[alt], svg[aria-label]");
      return !!t || (!!by && by.split(" ").some((id) => (document.getElementById(id)?.textContent ?? "").trim())) || !!img;
    };
    const unnamed = [...document.querySelectorAll("button, a[href], [role=button]")].filter(visible).filter((e) => !named(e)).map((e) => e.outerHTML.slice(0, 120));
    const fields = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea")].filter(visible);
    const unlabelled = fields.filter((f) => {
      const id = f.getAttribute("id");
      return !(f.getAttribute("aria-label") || f.getAttribute("aria-labelledby") || f.closest("label") || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || f.getAttribute("title"));
    }).map((e) => e.outerHTML.slice(0, 120));
    const noAlt = [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).map((e) => e.outerHTML.slice(0, 120));
    return {
      lang: document.documentElement.lang, h1: [...document.querySelectorAll("h1")].filter(visible).length,
      unnamed, unlabelled, noAlt, over: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  expect(r.lang, `${where}: html lang`).toBeTruthy();
  expect(r.h1, `${where}: one visible h1`).toBeGreaterThanOrEqual(1);
  expect(r.unnamed, `${where}: buttons and links without a name`).toEqual([]);
  expect(r.unlabelled, `${where}: form fields without a label`).toEqual([]);
  expect(r.noAlt, `${where}: images without alt`).toEqual([]);
  expect(r.over, `${where}: scrolls sideways by ${r.over}px`).toBeLessThanOrEqual(0);
}

const SCREENS: { role: string; who: TestUser; pages: string[] }[] = [
  { role: "Loan Associate", who: "Continue as Loan Associate", pages: ["/dashboard", "/inbox", "/inbox?tab=pool", "/loans", "/search"] },
  { role: "Document Processor", who: "Continue as Test Document Processor", pages: ["/dashboard", "/jobs", "/my-funds"] },
  { role: "Finance", who: "Continue as Test Finance", pages: ["/dashboard", "/funds"] },
  { role: "Admin", who: "Continue as Admin", pages: ["/open-items", "/admin/users", "/admin/settings", "/admin/audit", "/reports/tat"] },
  { role: "Superadmin", who: SUPERADMIN, pages: ["/admin/audit/files"] },
];

for (const s of SCREENS) {
  test(`${s.role}: main screens pass the accessibility and phone-width basics`, async ({ page }) => {
    await signInWith(page, s.who);
    for (const p of s.pages) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      await basics(page, `${s.role} ${p} at ${page.viewportSize()?.width}px`);
    }
  });
}
