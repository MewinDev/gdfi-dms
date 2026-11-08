import { expect, test, type Page } from "@playwright/test";
import { db } from "./db";
import { signIn } from "./helpers";
import { renderEmail, fill, fillLines, EMAIL_EVENTS, SAMPLE_VARS } from "../../lib/email/templates";

/**
 * Settings > System > Email notifications: the switch (with confirmation), the test-email pop-up,
 * Edit message with a live preview, Recent emails (a row opens the message, Resend). The server has
 * no Microsoft settings here, so nothing can be sent for real. Screenshots go to SHOTS_DIR.
 */
const dialog = (page: Page) => page.locator("dialog#settings-modal");
async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}
const setting = (key: string, value: unknown) => db.setting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
async function reset() {
  await setting("email.active", false);
  await setting("email.events", {});
  await setting("email.templates", {});
  await db.emailOutbox.deleteMany();
  await db.user.updateMany({ data: { emailNonUrgent: true } });
}
test.beforeEach(reset);
test.afterAll(reset);

async function seedOutbox() {
  const joy = await db.user.findUniqueOrThrow({ where: { email: "dp.joy@gdfi.ph" } });
  const base = { userId: joy.id, toName: "Joy Navarro (DP)", intendedAddress: joy.email, link: "http://localhost:3001/jobs/x", urgent: true };
  const mk = (event: keyof typeof EMAIL_EVENTS, minutesAgo: number, status: "SENT" | "FAILED" | "SKIPPED" | "QUEUED", lastError: string | null) => {
    const headline = fill(EMAIL_EVENTS[event].subject, SAMPLE_VARS);
    const { html, text } = renderEmail({ headline, lines: fillLines(EMAIL_EVENTS[event].body, SAMPLE_VARS), link: base.link });
    return db.emailOutbox.create({ data: { ...base, event, headline, subject: headline, html, text, status, lastError, toAddress: joy.email, attempts: status === "SKIPPED" ? 0 : 1, createdAt: new Date(Date.now() - minutesAgo * 60_000) } });
  };
  await mk("job_sent", 3, "SENT", null);
  await mk("returned_to_la", 9, "FAILED", "The sender is not allowed to send mail: check the Mail.Send permission and its admin consent.");
  await mk("hold_changed", 25, "SKIPPED", "Emails are off");
}

test("Email card: off by default, turning on asks first, test email, recent emails", async ({ page }) => {
  await seedOutbox();
  await signIn(page, "admin");
  await page.goto("/admin/settings");
  await expect(page.getByRole("link", { name: /^Email notifications/ })).toContainText("Not active");
  await page.goto("/admin/settings?open=email");
  const d = dialog(page);
  await expect(d.getByRole("heading", { name: "Email notifications" })).toBeVisible();
  await expect(d.locator("[data-email-state]")).toHaveText("Not active");
  // Never a real email from an automated test: with the Microsoft settings present, Send is not pressed.
  const configured = !(await d.locator("[data-sender-line]").textContent())?.includes("Not set up");
  await expect(d.locator("[data-sender-line]")).toContainText(configured ? "Sends from" : "Not set up");
  await expect(d.locator("[data-test-mode-note]")).toHaveText("Test mode: every email goes to the test address, not to the real person.");
  await expect(d.locator("[data-email-event]")).toHaveCount(Object.keys(EMAIL_EVENTS).length);
  await shot(page, "email-card-off");
  await noSideways(page);

  // Turning on asks first; cancelling keeps it off.
  const sw = d.getByRole("switch", { name: "Emails Active" });
  await sw.click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText("Turn on emails?")).toBeVisible();
  await expect(confirm.getByText("People will start getting emails for the events below.")).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(d.locator("[data-email-state]")).toHaveText("Not active");
  await sw.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Turn on emails" }).click();
  await expect(d.locator("[data-email-state]")).toHaveText("Active");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await shot(page, "email-card-on");
  expect(await db.auditLog.count({ where: { action: "email_switch_changed" } })).toBeGreaterThan(0);
  // Off again: no question.
  await sw.click();
  await expect(d.locator("[data-email-state]")).toHaveText("Not active");

  // Test email: the address defaults to the Admin's own; the result in plain words.
  await d.getByRole("button", { name: "Send a test email" }).click();
  const pop = page.getByRole("dialog", { name: "Send a test email" });
  await expect(pop.getByLabel("Send to")).toHaveValue("test.admin@gdfi.ph");
  if (!configured) {
    await pop.getByRole("button", { name: "Send", exact: true }).click();
    await expect(pop.locator("[data-test-result]")).toHaveText("Email is not set up: the Microsoft settings are missing on the server.");
  }
  await shot(page, "test-email-popup");
  await noSideways(page);
  await pop.getByRole("button", { name: "Close" }).last().click();

  // Recent emails: status chips, the reason for Failed, a row opens the message; Resend.
  await page.goto("/admin/settings?open=email");
  const table = d.locator("[data-recent-emails]");
  await expect(table.getByRole("row")).toHaveCount(configured ? 4 : 5); // header, 3 seeded, and the test email when one was tried
  await expect(table).toContainText("Mail.Send permission");
  await expect(table.getByText("Skipped", { exact: true })).toBeVisible();
  await table.scrollIntoViewIfNeeded();
  await shot(page, "recent-emails");
  await noSideways(page);
  await table.getByRole("button", { name: "Job sent to a processor" }).click();
  const msg = page.getByRole("dialog", { name: "Email" });
  await expect(msg.locator("[data-email-message]")).toContainText("PN-0001003: Notary sent to you");
  await shot(page, "recent-email-message");
  await msg.getByRole("button", { name: "Close" }).last().click();
  const failed = table.getByRole("row").filter({ hasText: "Returned to the LA" });
  await failed.getByRole("button", { name: "Resend" }).click();
  await expect(table.getByRole("row").filter({ hasText: "Returned to the LA" }).getByText("Queued", { exact: true })).toBeVisible();
  // Filters: Skipped only.
  await d.getByLabel("Status").selectOption("SKIPPED");
  await d.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page).toHaveURL(/status=SKIPPED/);
  await expect(d.locator("[data-recent-emails]").getByRole("row")).toHaveCount(2);
});

test("Edit message: placeholders checked, live preview, discard asks first, reset to default", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/settings?open=email");
  await dialog(page).locator('[data-email-event="job_sent"]').getByRole("link", { name: "Edit message" }).click();
  await expect(page).toHaveURL(/edit=job_sent/);
  const d = dialog(page);
  await expect(d.getByRole("heading", { name: "Edit message: Job sent to a processor" })).toBeVisible();
  const subject = d.getByLabel("Subject");
  await expect(subject).toHaveValue("{pn}: {transaction} sent to you");
  await subject.fill("New job {bogus}: {pn}");
  await expect(d.getByText("Unknown placeholder {bogus}. Use one from the list.").first()).toBeVisible();
  await d.getByRole("button", { name: "Save" }).click();
  await expect(d.getByText("Unknown placeholder {bogus}. Use one from the list.").first()).toBeVisible();
  await subject.fill("New job for you: {pn} {transaction}");
  await expect(d.locator("[data-email-preview]")).toContainText("New job for you: PN-0001003 Notary");
  await expect(d.locator("[data-email-preview] iframe")).toBeVisible();
  await shot(page, "edit-message-popup");
  await noSideways(page);
  // Unsaved: Cancel asks first.
  await d.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog").getByText("Discard your changes?")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Keep editing" }).click();
  await d.getByRole("button", { name: "Save" }).click();
  await expect(d.getByText("Message saved.")).toBeVisible();
  expect(((await db.setting.findUniqueOrThrow({ where: { key: "email.templates" } })).value as Record<string, { subject: string }>).job_sent.subject).toBe("New job for you: {pn} {transaction}");
  await page.goto("/admin/settings?open=email");
  await expect(dialog(page).locator('[data-email-event="job_sent"]')).toContainText("Edited");
  await dialog(page).locator('[data-email-event="job_sent"]').getByRole("link", { name: "Edit message" }).click();
  await dialog(page).getByRole("button", { name: "Reset to default" }).click();
  await expect(dialog(page).getByText("Message reset to the default.")).toBeVisible();
  await expect(dialog(page).getByLabel("Subject")).toHaveValue("{pn}: {transaction} sent to you");
});

test("Updates: the person's own switch for non-urgent emails; a sample email", async ({ page }) => {
  await signIn(page, "la");
  await page.goto("/notifications");
  const pref = page.locator("[data-email-pref]");
  const sw = pref.getByRole("switch", { name: "Email me for non-urgent updates" });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  expect((await db.user.findUniqueOrThrow({ where: { email: "test.la@gdfi.ph" } })).emailNonUrgent).toBe(false);
  await noSideways(page);
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");

  // One sample email, rendered as people get it (test mode note, gold button, footer).
  const headline = "PN-0001003: Notary sent to you";
  const { html } = renderEmail({
    headline, note: "Would have gone to: Joy Navarro (DP)",
    lines: fillLines(EMAIL_EVENTS.job_sent.body, { ...SAMPLE_VARS, who: "Ana Reyes", reason: "Process at: LTO Mandaue." }), link: "http://localhost:3001/jobs/sample",
  });
  await page.setContent(html);
  await expect(page.getByRole("link", { name: "Open in GDFI DMS" })).toBeVisible();
  await shot(page, "sample-email");
});
