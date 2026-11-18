# 21 Security (headers, cookies, secrets, scans)

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

Keep borrower data and the system safe with a small set of controls (D-055: minimal and compact). Roles: developer and infrastructure.

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Security headers in one place: CSP (self and what the app needs; Microsoft sign-in form target), HSTS in production only, nosniff, frame DENY / frame-ancestors 'none', Referrer-Policy same-origin | ✅ Built | every response | n/a | No | `lib/security/headers.ts`, `next.config.ts`, `lib/security/headers.test.ts` | Browser dev tools, Network, response headers |
| 2 | Session cookie: Secure (production), HttpOnly, SameSite=Lax, signed | ✅ Built | n/a | n/a | No | `lib/auth/session.ts`, same test | n/a |
| 3 | Secrets only in the environment, never in the repository; secret scan test | ✅ Built | n/a | n/a | No | `lib/env/secret-scan.ts`, `secret-scan.test.ts` | n/a |
| 4 | Permission scan: every action and route checks a permission | ✅ Built | n/a | n/a | No | `lib/auth/permission-scan.test.ts` | n/a |
| 5 | Migration scan (`npm run migrate:check`) | ✅ Built | n/a | n/a | No | `lib/db/migration-check.ts` | n/a |
| 6 | Startup refuses unsafe production settings (names the variable, never the value) | ✅ Built | n/a | n/a | No | `lib/env/check.ts`, `check.test.ts` | Start with `TEST_MODE=true` in production: refused |
| 7 | Test helpers refused in production | ✅ Built | n/a | n/a | No | `docs/ENVIRONMENT.md` | UAT SA-6 |
| 8 | Branch scope and file access log (data access) | ✅ Built | n/a | n/a | No | modules 03, 17 | n/a |
| 9 | Only the last 4 digits of an account stored and shown | ✅ Built | Funds | n/a | No | `accountLast4` | n/a |
| 10 | Borrower address, contact and birth date not stored | ✅ Built | n/a | n/a | No | D-037, migration 025 | n/a |
| 11 | No `NEXT_PUBLIC_` variables (nothing secret reaches the browser) | ✅ Built | n/a | n/a | No | `docs/ENVIRONMENT.md` | n/a |
| 12 | Rotate any secret ever pasted into chat or email before go-live | ⏸ Blocked (infrastructure, at go-live) | n/a | n/a | n/a | `docs/ENVIRONMENT.md` Production checklist step 6 | n/a |
| 13 | Microsoft sign-in | ❌ Missing | n/a | n/a | n/a | module 01 row 1 | n/a |
| 14 | Privacy notice | ✅ As decided: not needed (Changed by D-055) | n/a | n/a | n/a | D-055 | n/a |

## D. Known limits and open questions

- The CSP allows inline scripts and styles (Next.js needs them without nonces); tightening with nonces is possible later if a security review asks.
