import { timingSafeEqual } from "node:crypto";

/** The scheduler sends CRON_SECRET in the "x-cron-secret" header (or "Authorization: Bearer ..."). No secret set: refused. */
export function cronAllowed(headers: Headers, secret: string | undefined = process.env.CRON_SECRET): boolean {
  const want = secret?.trim();
  if (!want || want.length < 16) return false;
  const auth = headers.get("authorization");
  const got = headers.get("x-cron-secret") ?? (auth?.startsWith("Bearer ") ? auth.slice(7) : null);
  if (!got) return false;
  const a = Buffer.from(got.trim());
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
