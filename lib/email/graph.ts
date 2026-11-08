import "server-only";

/**
 * Sends one email through Microsoft Graph (client-credentials flow). The credentials are read from
 * server environment variables only and never leave this module: no logs, no errors, no database.
 * Failures come back as plain reasons the Admin can act on.
 */
export interface MailMessage { to: string; subject: string; html: string; text: string }
export type SendResult =
  | { ok: true }
  | { ok: false; reason: string; permanent: boolean; retryAfterMs?: number };

type FetchFn = typeof fetch;
let fetchImpl: FetchFn = (...a) => fetch(...a);
/** Tests only: a fake Graph. */
export function setGraphFetch(f: FetchFn | null) { fetchImpl = f ?? ((...a) => fetch(...a)); token = null; }

const TIMEOUT_MS = 15_000;

/** Is email set up? The sender address is the only value that may be shown. */
export function graphConfig() {
  const sender = process.env.GRAPH_SENDER_EMAIL?.trim() || "";
  const configured = !!(process.env.GRAPH_CLIENT_ID?.trim() && process.env.GRAPH_CLIENT_SECRET?.trim() && process.env.GRAPH_TENANT_ID?.trim() && sender);
  return { configured, sender };
}

let token: { value: string; expiresAt: number } | null = null;
/** Tests only. */
export function tokenCacheState() { return token ? { cached: true, expiresAt: token.expiresAt } : { cached: false, expiresAt: 0 }; }

/** Microsoft's own error code (for example ErrorAccessDenied): safe to show, helps the Admin. */
async function msCode(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string | { code?: string }; error_codes?: number[] };
    const c = typeof j.error === "string" ? j.error : j.error?.code;
    return c && /^[A-Za-z0-9_.-]{1,80}$/.test(c) ? ` (Microsoft: ${c})` : "";
  } catch { return ""; }
}

function retryAfter(r: Response): number | undefined {
  const h = r.headers.get("retry-after");
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.min(Math.max(s, 1), 3600) * 1000;
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.max(d - Date.now(), 1000) : undefined;
}

async function getToken(now: number): Promise<{ ok: true; value: string } | Extract<SendResult, { ok: false }>> {
  // Cached until 5 minutes before it expires.
  if (token && token.expiresAt - 5 * 60_000 > now) return { ok: true, value: token.value };
  const tenant = encodeURIComponent(process.env.GRAPH_TENANT_ID!.trim());
  const body = new URLSearchParams({
    client_id: process.env.GRAPH_CLIENT_ID!.trim(),
    client_secret: process.env.GRAPH_CLIENT_SECRET!.trim(),
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  let r: Response;
  try {
    r = await fetchImpl(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "Network problem: could not reach Microsoft.", permanent: false };
  }
  if (r.status === 429 || r.status >= 500) return { ok: false, reason: "Microsoft is busy. It will try again.", permanent: false, retryAfterMs: retryAfter(r) };
  if (!r.ok) return { ok: false, reason: `Microsoft refused the sign-in: check the client id, secret and tenant${await msCode(r)}.`, permanent: true };
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!j.access_token) return { ok: false, reason: "Microsoft refused the sign-in.", permanent: true };
  token = { value: j.access_token, expiresAt: now + (j.expires_in ?? 3600) * 1000 };
  return { ok: true, value: token.value };
}

/** One email. HTML body; the plain-text version is kept in the outbox (Graph's JSON send takes one body). */
export async function sendMail(m: MailMessage, now: number = Date.now()): Promise<SendResult> {
  const { configured, sender } = graphConfig();
  if (!configured) return { ok: false, reason: "Email is not set up: the Microsoft settings are missing on the server.", permanent: true };
  for (let tryNo = 0; tryNo < 2; tryNo++) {
    const t = await getToken(now);
    if (!t.ok) return t;
    let r: Response;
    try {
      r = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
        method: "POST",
        headers: { authorization: `Bearer ${t.value}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: { subject: m.subject, body: { contentType: "HTML", content: m.html }, toRecipients: [{ emailAddress: { address: m.to } }] },
          saveToSentItems: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { ok: false, reason: "Network problem: could not reach Microsoft.", permanent: false };
    }
    if (r.status === 202 || r.ok) return { ok: true };
    // An old token: get a fresh one once.
    if (r.status === 401 && tryNo === 0) { token = null; continue; }
    if (r.status === 429 || r.status === 503 || r.status === 504) return { ok: false, reason: "Microsoft asked to slow down. It will try again.", permanent: false, retryAfterMs: retryAfter(r) };
    if (r.status >= 500) return { ok: false, reason: "Microsoft had a problem. It will try again.", permanent: false, retryAfterMs: retryAfter(r) };
    if (r.status === 401 || r.status === 403) return { ok: false, reason: `The sender is not allowed to send mail: check the Mail.Send permission and its admin consent${await msCode(r)}.`, permanent: true };
    if (r.status === 404) return { ok: false, reason: `The sender mailbox was not found: check GRAPH_SENDER_EMAIL${await msCode(r)}.`, permanent: true };
    return { ok: false, reason: `Microsoft refused the message${await msCode(r)}.`, permanent: true };
  }
  return { ok: false, reason: "Microsoft refused the sign-in.", permanent: true };
}
