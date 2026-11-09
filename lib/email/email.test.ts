import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMAIL_EVENTS, EMAIL_EVENT_KEYS, EMAIL_FOOTER, SAMPLE_VARS, fill, fillLines, renderEmail, unknownPlaceholders } from "./templates";
import { sendMail, setGraphFetch, tokenCacheState } from "./graph";
import { cronAllowed } from "./cron-auth";

const SECRET = "SEKRET-value-never-shown-123";
const ENV = { GRAPH_CLIENT_ID: "client-id-abc", GRAPH_CLIENT_SECRET: SECRET, GRAPH_TENANT_ID: "tenant-xyz", GRAPH_SENDER_EMAIL: "no-reply@gdfi.ph" };
const msg = { to: "jamerin@gdfi.ph", subject: "Hello", html: "<p>Hi</p>", text: "Hi" };

function fakeGraph(responses: ((url: string, init: RequestInit) => Response)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  setGraphFetch((async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next(u, init ?? {});
  }) as typeof fetch);
  return calls;
}
const tokenOk = (expiresIn = 3600) => () => new Response(JSON.stringify({ access_token: "TOKEN-123", expires_in: expiresIn }), { status: 200 });
const sent = () => new Response(null, { status: 202 });

describe("Email messages", () => {
  it("every event has a label, recipients and only known placeholders", () => {
    for (const k of EMAIL_EVENT_KEYS) {
      const e = EMAIL_EVENTS[k];
      expect(e.label.length).toBeGreaterThan(3);
      expect(unknownPlaceholders(e.subject + e.body)).toEqual([]);
    }
  });
  it("placeholders: unknown ones are found; empty lines dropped", () => {
    expect(unknownPlaceholders("{pn} {bogus} {who} {Amount}")).toEqual(["bogus", "Amount"]);
    expect(fill("{pn}: {transaction}", { pn: "PN-1", transaction: "Notary" })).toBe("PN-1: Notary");
    expect(fillLines("Line {pn}\n{reason}\nEnd", { pn: "PN-1" })).toEqual(["Line PN-1", "End"]);
  });
  it("branded HTML with one gold button and the footer; a plain-text version", () => {
    const { html, text } = renderEmail({ headline: "PN-1: Notary sent to you", lines: ["<b>x</b> & y"], link: "http://localhost:3001/jobs/1", note: null });
    expect(html).toContain("#0c2340");
    expect(html).toContain("#f5a623");
    expect(html).toContain("Open in GDFI DMS");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
    expect(html).toContain(EMAIL_FOOTER);
    expect(text).toContain("Open in GDFI DMS: http://localhost:3001/jobs/1");
    expect(text).toContain(EMAIL_FOOTER);
    expect(fill(EMAIL_EVENTS.job_sent.subject, SAMPLE_VARS)).toBe("GD1652026901003: Notary sent to you");
  });
});

describe("Microsoft Graph sender (mocked)", () => {
  const saved = { ...process.env };
  beforeEach(() => { Object.assign(process.env, ENV); setGraphFetch(null); });
  afterEach(() => { process.env = { ...saved }; setGraphFetch(null); });

  it("not set up: a plain reason, no network", async () => {
    delete process.env.GRAPH_CLIENT_SECRET;
    const calls = fakeGraph([]);
    expect(await sendMail(msg)).toMatchObject({ ok: false, permanent: true, reason: expect.stringMatching(/not set up/) });
    expect(calls).toHaveLength(0);
  });

  it("client credentials, sendMail with saveToSentItems false; the token is cached until shortly before it expires", async () => {
    const calls = fakeGraph([tokenOk(3600), sent, sent, tokenOk(3600), sent]);
    const t0 = 1_800_000_000_000;
    expect(await sendMail(msg, t0)).toEqual({ ok: true });
    expect(calls[0].url).toBe("https://login.microsoftonline.com/tenant-xyz/oauth2/v2.0/token");
    expect(String(calls[0].init.body)).toContain("scope=https%3A%2F%2Fgraph.microsoft.com%2F.default");
    expect(calls[1].url).toBe("https://graph.microsoft.com/v1.0/users/no-reply%40gdfi.ph/sendMail");
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ saveToSentItems: false, message: { toRecipients: [{ emailAddress: { address: "jamerin@gdfi.ph" } }] } });
    await sendMail(msg, t0 + 30 * 60_000);
    expect(calls).toHaveLength(3); // cached
    expect(tokenCacheState().cached).toBe(true);
    await sendMail(msg, t0 + 56 * 60_000); // within 5 minutes of expiry: a new token
    expect(calls).toHaveLength(5);
  });

  it("429 honours Retry-After; 403 names Mail.Send; refused sign-in; network problem; never the secret or token", async () => {
    fakeGraph([tokenOk(), () => new Response("{}", { status: 429, headers: { "retry-after": "120" } })]);
    const a = await sendMail(msg);
    expect(a).toMatchObject({ ok: false, permanent: false, retryAfterMs: 120_000 });
    fakeGraph([tokenOk(), () => new Response(JSON.stringify({ error: { code: "ErrorAccessDenied", message: `token TOKEN-123 secret ${SECRET}` } }), { status: 403 })]);
    const b = await sendMail(msg);
    expect(b).toMatchObject({ ok: false, permanent: true });
    expect(!b.ok && b.reason).toBe("The sender is not allowed to send mail: check the Mail.Send permission and its admin consent (Microsoft: ErrorAccessDenied).");
    fakeGraph([() => new Response(JSON.stringify({ error: "invalid_client", error_description: SECRET }), { status: 401 })]);
    const c = await sendMail(msg);
    expect(!c.ok && c.reason).toMatch(/^Microsoft refused the sign-in/);
    fakeGraph([() => { throw new TypeError("fetch failed " + SECRET); }]);
    const d = await sendMail(msg);
    expect(d).toMatchObject({ ok: false, permanent: false, reason: "Network problem: could not reach Microsoft." });
    for (const r of [a, b, c, d]) {
      expect(JSON.stringify(r)).not.toContain(SECRET);
      expect(JSON.stringify(r)).not.toContain("TOKEN-123");
      expect(JSON.stringify(r)).not.toContain("client-id-abc");
    }
  });

  it("an expired token (401 on send) is replaced once", async () => {
    const calls = fakeGraph([tokenOk(), () => new Response("{}", { status: 401 }), tokenOk(), sent]);
    expect(await sendMail(msg)).toEqual({ ok: true });
    expect(calls).toHaveLength(4);
  });
});

describe("Cron secret", () => {
  it("needs the CRON_SECRET header (16+ characters); refused when not set", () => {
    const h = (v: Record<string, string>) => new Headers(v);
    expect(cronAllowed(h({ "x-cron-secret": "a-long-cron-secret-1" }), "a-long-cron-secret-1")).toBe(true);
    expect(cronAllowed(h({ authorization: "Bearer a-long-cron-secret-1" }), "a-long-cron-secret-1")).toBe(true);
    expect(cronAllowed(h({ "x-cron-secret": "wrong" }), "a-long-cron-secret-1")).toBe(false);
    expect(cronAllowed(h({}), "a-long-cron-secret-1")).toBe(false);
    expect(cronAllowed(h({ "x-cron-secret": "" }), undefined)).toBe(false);
    expect(cronAllowed(h({ "x-cron-secret": "short" }), "short")).toBe(false);
  });
});
