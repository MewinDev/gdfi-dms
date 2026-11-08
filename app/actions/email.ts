"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, type ActionState } from "@/lib/action";
import { getCurrentUser } from "@/lib/auth/current-user";
import { AuthzError } from "@/lib/auth/current-user";
import {
  resendEmail, resetEmailTemplate, saveEmailTemplate, sendTestEmail, setEmailActive, setEmailEvent, setMyEmailNonUrgent,
} from "@/lib/email/outbox";
import { UserError } from "@/lib/services/errors";

const SETTINGS = "/admin/settings";

export async function emailSwitchAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.EMAIL_MANAGE);
    const on = str(fd, "value") === "on";
    await setEmailActive(u, on);
    revalidatePath(SETTINGS);
    return on ? "Emails are Active." : "Emails are Not active.";
  });
}

export async function emailEventAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.EMAIL_MANAGE);
    const on = str(fd, "value") === "on";
    await setEmailEvent(u, str(fd, "event"), on);
    revalidatePath(SETTINGS);
    return on ? "Emails for this event are on." : "Emails for this event are off.";
  });
}

export async function emailTemplateAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.EMAIL_MANAGE);
    const event = str(fd, "event");
    if (fd.get("$reset")) {
      await resetEmailTemplate(u, event);
      revalidatePath(SETTINGS);
      return "Message reset to the default.";
    }
    await saveEmailTemplate(u, event, { subject: str(fd, "subject"), body: String(fd.get("body") ?? "") });
    revalidatePath(SETTINGS);
    return "Message saved.";
  });
}

/** The result is shown in the pop-up ("Sent to ..." or the plain reason). */
export async function testEmailAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePermission(PERMISSIONS.EMAIL_MANAGE);
    const r = await sendTestEmail(u, str(fd, "to"));
    revalidatePath(SETTINGS);
    return r.ok ? { ok: true, message: r.message, at: Date.now() } : { ok: false, error: r.message, at: Date.now() };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message, field: e.field, at: Date.now() };
    if (e instanceof AuthzError) return { ok: false, error: e.message, at: Date.now() };
    return { ok: false, error: "The test email could not be sent. Try again.", at: Date.now() };
  }
}

export async function resendEmailAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.EMAIL_MANAGE);
    await resendEmail(u, str(fd, "id"));
    revalidatePath(SETTINGS);
    return "It will be sent again in a moment.";
  });
}

/** Anyone signed in: their own "Email me for non-urgent updates" switch. */
export async function myEmailPreferenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await getCurrentUser();
    if (!u) throw new AuthzError("Sign in first.");
    const on = str(fd, "value") === "on";
    await setMyEmailNonUrgent(u, on);
    revalidatePath("/notifications");
    return on ? "You will get emails for non-urgent updates." : "Only urgent emails from now on.";
  });
}
