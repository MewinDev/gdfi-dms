import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByText("Pick an area to change it.")).toBeVisible();
});

const dialog = (page: import("@playwright/test").Page) => page.locator("dialog#settings-modal");

// TEST_MODE is true on the dev server, so Test data shows. "Hidden when TEST_MODE is off" is a unit test.
test("cards are grouped under four headings, in order; Jump to scrolls to a group; group cards open their pop-ups", async ({ page }) => {
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(["Company setup", "People and access", "Documents and steps", "Time and money", "System and testing"]);
  const groups: [string, string[]][] = [
    ["Company setup", ["Branches", "LTO offices", "Loan types"]],
    ["People and access", ["Roles and access", "Processor capacity"]], // users: the Users page in the sidebar
    ["Documents and steps", ["Transaction types", "Document types", "Checklist items", "Processing stages", "Problem reasons", "Hold reasons", "Return reasons"]],
    ["Time and money", ["Turnaround times", "Holidays", "Cash-advance rules", "Expense kinds", "Funds types", "Approval bands"]],
    ["System and testing", ["System and test mode", "MyLoans sync", "Email notifications", "Test data"]],
  ];
  for (const [g, cards] of groups) {
    const section = main.getByRole("region", { name: g });
    const links = section.getByRole("link");
    await expect(links).toHaveCount(cards.length);
    for (let i = 0; i < cards.length; i++) await expect(links.nth(i)).toContainText(cards[i]);
  }
  // Headings are not buttons.
  await expect(main.getByRole("button", { name: "Company setup" })).toHaveCount(0);

  const jump = page.getByRole("navigation", { name: "Jump to" });
  if (page.viewportSize()!.width >= 600) {
    await jump.getByRole("link", { name: "System and testing" }).click();
    await expect(page).toHaveURL(/#group-system/);
    await expect(main.getByRole("region", { name: "System and testing" })).toBeInViewport();
  } else {
    await expect(jump).toBeHidden();
  }

  await main.getByRole("region", { name: "Time and money" }).getByRole("link", { name: /^Holidays/ }).click();
  await expect(page).toHaveURL(/open=holidays/);
  await expect(page.getByRole("dialog", { name: "Holidays" })).toBeVisible();
});

test("cards open the right modal; refresh keeps it open; Esc closes and focus returns to the card", async ({ page }) => {
  await page.getByRole("link", { name: /^Checklist items/ }).click();
  await expect(page).toHaveURL(/open=checklist/);
  await expect(page.getByRole("dialog", { name: "Checklist items" })).toBeVisible();
  await expect(dialog(page).getByText("Promissory Note").first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("dialog", { name: "Checklist items" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/open=/);
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("card-checklist");
});

test("X and a click outside close the modal", async ({ page }) => {
  await page.getByRole("link", { name: /^Branches/ }).click();
  await expect(page.getByRole("dialog", { name: "Branches" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Close" }).click();
  await expect(dialog(page)).toHaveCount(0);

  const vw = page.viewportSize()!.width;
  test.skip(vw < 600, "On phones the modal is a full-screen sheet: there is no outside to click.");
  await page.getByRole("link", { name: /^LTO offices/ }).click();
  await expect(page.getByRole("dialog", { name: "LTO offices" })).toBeVisible();
  await page.mouse.click(8, page.viewportSize()!.height - 8);
  await expect(dialog(page)).toHaveCount(0);
});

// Unsaved changes: see discard-confirm.spec.ts.

test("keyboard focus stays inside the modal", async ({ page }) => {
  await page.getByRole("link", { name: /^Holidays/ }).click();
  await expect(page.getByRole("dialog", { name: "Holidays" })).toBeVisible();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(i % 7 === 6 ? "Shift+Tab" : "Tab");
    expect(await page.evaluate(() => document.getElementById("settings-modal")?.contains(document.activeElement) ?? false)).toBe(true);
  }
});
