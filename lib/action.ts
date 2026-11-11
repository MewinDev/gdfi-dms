import "server-only";
import { AuthzError } from "@/lib/auth/current-user";
import { MissingPapersError, NotInScopeError, UserError } from "@/lib/services/errors";

export type ActionState = { ok: boolean; message?: string; error?: string; field?: string; at?: number; missing?: string[]; needsRemarks?: string[] } | null;

/** Runs a server action body and turns errors into friendly messages (never stack traces). */
export async function runAction(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    return { ok: true, message: message ?? "Saved.", at: Date.now() };
  } catch (e) {
    if (e instanceof MissingPapersError) return { ok: false, error: e.message, field: "missing", missing: e.missing, needsRemarks: e.needsRemarks, at: Date.now() };
    if (e instanceof UserError) return { ok: false, error: e.message, field: e.field, at: Date.now() };
    if (e instanceof AuthzError) return { ok: false, error: e.message, at: Date.now() };
    if (e instanceof NotInScopeError) return { ok: false, error: "Loan File not found.", at: Date.now() };
    // Next.js redirect()/notFound() throw special errors that must propagate.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    console.error(e);
    return { ok: false, error: "Something went wrong. Nothing was changed. Try again, or contact IT if it keeps happening.", at: Date.now() };
  }
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const strOrNull = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" ? null : v;
};
