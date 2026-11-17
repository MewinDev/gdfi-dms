"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, type ActionState } from "@/lib/action";
import { addCalendarEntry, previewEntry, previewWorkingDays, saveWorkingDays, type EntryInput } from "@/lib/services/calendar";

/**
 * Settings, Holidays and working days (D-041). Each form has Check (the preview: "This will extend N items (M
 * currently overdue)", nothing saved) and Save (the same values; the server checks and applies again).
 */

function entryFrom(fd: FormData): EntryInput {
  const kind = str(fd, "kind") === "CLOSURE" ? "CLOSURE" : "HOLIDAY";
  return {
    kind, date: str(fd, "date"), name: str(fd, "name"), type: (str(fd, "type") || "REGULAR") as EntryInput["type"],
    allBranches: kind === "HOLIDAY" && str(fd, "scope") !== "some",
    branchIds: fd.getAll("branchIds").map(String).filter(Boolean), reason: str(fd, "reason"),
  };
}
const weekdaysFrom = (fd: FormData) => [0, 1, 2, 3, 4, 5, 6].map((i) => fd.get(`wd${i}`) === "on");

/** Check or Save a holiday or an office closure. */
export async function calendarEntryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const intent = str(fd, "intent");
  let preview = { extend: 0, overdue: 0 };
  const r = await runAction(async () => {
    const user = await requirePermission(PERMISSIONS.SETTINGS_HOLIDAYS);
    const e = entryFrom(fd);
    if (intent === "check") {
      const p = await previewEntry(user, e);
      preview = { extend: p.extend, overdue: p.overdue };
      return p.text;
    }
    const s = await addCalendarEntry(user, e);
    preview = { extend: s.extend, overdue: s.overdue };
    revalidatePath("/admin/settings");
    revalidatePath("/jobs");
    const what = e.kind === "CLOSURE" ? "Office closure saved." : "Holiday saved.";
    return s.extend ? `${what} ${s.extend} due date${s.extend === 1 ? "" : "s"} moved (${s.overdue} had been overdue); each owner was told.` : `${what} No saved due date changed.`;
  });
  return r && r.ok ? { ...r, preview: { ...preview, saved: intent !== "check" } } : r;
}

/** Check or Save the working weekdays. */
export async function workingDaysAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const intent = str(fd, "intent");
  let preview = { extend: 0, overdue: 0 };
  const r = await runAction(async () => {
    const user = await requirePermission(PERMISSIONS.SETTINGS_HOLIDAYS);
    const w = weekdaysFrom(fd);
    if (intent === "check") {
      const p = await previewWorkingDays(user, w);
      preview = { extend: p.extend, overdue: p.overdue };
      return p.text;
    }
    const s = await saveWorkingDays(user, w);
    preview = { extend: s.extend, overdue: s.overdue };
    revalidatePath("/admin/settings");
    return s.extend ? `Working days saved. ${s.extend} due date${s.extend === 1 ? "" : "s"} moved; each owner was told.` : "Working days saved. No saved due date changed.";
  });
  return r && r.ok ? { ...r, preview: { ...preview, saved: intent !== "check" } } : r;
}
