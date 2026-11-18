# 01 Sign-in and accounts

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

How people get into GDFI-DMS and how their accounts are kept. Locally, a test sign-in panel lets developers and testers sign in as any test user; on staging and production only Microsoft (Entra ID) sign-in is allowed. Roles: every user; Admin and Superadmin manage accounts.

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Microsoft sign-in (Entra ID, OIDC) for staging and production | ❌ Missing (needs the IT app registration) | `/login` | Everyone | `ENTRA_*` env | `lib/auth/providers.ts` (TODO `entraProvider`) | Sign in with a GDFI Microsoft account |
| 2 | Test sign-in (no password) only when `APP_ENV=local`; staging and production refuse to start with `AUTH_MODE=test` | ✅ Built | `/login` | Developers | `AUTH_MODE` | `lib/auth/mode.ts`, `lib/auth/mode.test.ts`, `lib/env/check.ts` (D-021) | On staging, the test panel is absent |
| 3 | Session cookie signed, HttpOnly, SameSite=Lax, Secure in production | ✅ Built | all pages | n/a | `SESSION_SECRET` (32+) | `lib/auth/session.ts`, `lib/security/headers.test.ts` | Browser dev tools show the cookie flags |
| 4 | Every page and action checks the signed-in user on the server | ✅ Built | all | n/a | No | `lib/auth/current-user.ts` (`requireUser`, `requirePagePermission`) | Open a page after signing out: back to `/login` |
| 5 | Users: add, edit, make inactive (never deleted), role, branches, home branch | ✅ Built | Users (`/admin/users`) | `users:view`, `users:edit` (Admin, Superadmin) | Yes | `lib/services/admin.ts` (`saveUser`), e2e `roles.spec.ts` | UAT ADM-1 |
| 6 | Import users from CSV (preview, then apply) | ✅ Built | Settings, Import / Export | `settings:import` (Admin, Superadmin) | Yes | `lib/import/*` | Import 2 test users |
| 7 | Away (from and to dates): cannot be named for new work, items shown to supervisors | ✅ Built | Inbox, Users | own; `users:away` for others (LA Supervisor/Head, Admin) | Yes | D-046, e2e `inbox.spec.ts` | UAT SUP-8 |
| 8 | "Users with no branches" warning | ✅ Built | Admin Home | Admin | No | HANDOVER (piece 3) | Make a user with no branch: Home warns |
| 9 | Test users never created in production; test helpers refused in production | ✅ Built | n/a | n/a | No | `lib/env/check.ts`, `docs/ENVIRONMENT.md` | UAT SA-6 |
| 10 | Sign-out | ✅ Built | top bar | Everyone | No | `app/login/actions.ts` | Sign out, Back button shows `/login` |

## D. Known limits and open questions

- Entra sign-in is the main go-live blocker (see `docs/PHASE_A_GAPS.md`). Needs: app registration, redirect URL, which group may sign in, and whether accounts are created on first sign-in or only by Admin.
- No password sign-in exists or is planned (Microsoft accounts only).
