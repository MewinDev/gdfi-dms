# Known issues

Last updated: 17 November 2026 (PHT)

## Funds page: React "missing key" warning in dev mode only

- **What:** in `next dev`, the browser console sometimes shows "Each child in a list should have a unique key prop. Check the render method of `FundsRow`. It was passed a child from FundsPage." About one run in four of `tests/e2e/funds-design.spec.ts` (which fails on any key warning) when run against the dev server (`E2E_SERVER=dev`).
- **Not in production:** never seen with the production build (the normal e2e run); React does not run this check there.
- **What we know:** React's owner stack points at the static children of the cells the Funds page builds on the server (`askedCell`, `amountCell`) and passes to the `FundsRow` client component. Every list in `app/(app)/funds/page.tsx` has keys; giving the static children explicit keys did not stop it, so it looks like a dev-only quirk in how server-built elements reach a client component.
- **Impact:** none for users. The dev-mode e2e run of `funds-design.spec.ts` can fail on it.
- **Next step if it matters:** build the cells as small client components that receive plain data (not elements), or retest after a Next.js / React upgrade.
