import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { securityHeaders } from "./headers";
import { sessionCookieOptions } from "@/lib/auth/session";
import nextConfig from "../../next.config";

describe("security headers and the session cookie (D-055)", () => {
  it("every route gets them; HSTS and no unsafe-eval in production; the cookie is HttpOnly, SameSite=Lax (Secure in production)", async () => {
    const prod = Object.fromEntries(securityHeaders({ dev: false, production: true }).map((h) => [h.key, h.value]));
    expect(prod).toMatchObject({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin", "Strict-Transport-Security": "max-age=31536000; includeSubDomains" });
    expect(prod["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(prod["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(prod["Content-Security-Policy"]).not.toContain("unsafe-eval");
    // D-057: fonts are self-hosted; font-src allows the own origin only.
    expect(prod["Content-Security-Policy"].split("; ")).toContain("font-src 'self'");
    expect(readFileSync("app/layout.tsx", "utf8")).not.toContain("next/font/google"); // the build must not need Google Fonts
    const local = Object.fromEntries(securityHeaders({ dev: true, production: false }).map((h) => [h.key, h.value]));
    expect(local["Strict-Transport-Security"]).toBeUndefined();
    const rules = await nextConfig.headers!();
    expect(rules[0].source).toBe("/:path*");
    expect(rules[0].headers.map((h) => h.key)).toEqual(expect.arrayContaining(["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"]));
    expect(sessionCookieOptions).toMatchObject({ httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  });
});
