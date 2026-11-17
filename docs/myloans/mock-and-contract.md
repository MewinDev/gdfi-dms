# myloans: the mock, the contract client and the contract tests (piece 6)

Last updated: 18 November 2026 (PHT)

Built in piece 6 (D-047, D-048; plan: `IMPLEMENTATION_PLAN.md` section 7.4). The agreed query is `docs/myloans-api-contract.sql` (round 3).

## One client, two modes

- `lib/myloans/v1/client.ts` is the one way to call myloans:
  - API 1 `GET /loans/{pn}`;
  - API 2 `GET /loans/changes?since=&afterId=&limit=`;
  - the pool mode `GET /loans/changes?releasedSince=&afterId=&limit=` (URL proposed);
  - API 4 `GET /branches`;
  - API 5 `GET /products`.
- What the client does on every call:
  - sends the key as a Bearer header, with a timeout;
  - retries with backoff when there is no answer, and honours Retry-After on 429;
  - uses the circuit breaker and the shared hourly count.
- What comes back:
  - every answer is checked against `lib/myloans/v1/schema.ts`: every column of the query, camelCase, amounts as strings, dates in +08:00, a 64-hex hash;
  - a drift is one line: "myloans sent something we did not expect: items.0.contentHash".
- Plain messages, never the address or the key:
  - "MyLoans did not answer. Try again in a moment.";
  - "myloans is busy. Try again in a few minutes.";
  - "myloans refused the DMS key. Ask IT to check the myloans key setting."
- **`MYLOANS_MODE=mock`:** the app's own mock.
  - In-process by default (no network).
  - Over HTTP when `MYLOANS_MOCK_URL` points at a running app (for example `http://localhost:3000/api/dev/myloans/api/dms/v1`).
  - Mock mode never calls a real address, whatever `MYLOANS_BASE_URL` says.
- **`MYLOANS_MODE=live`:** `MYLOANS_BASE_URL` with `MYLOANS_API_KEY` (server settings only).

## The mock

- **Route:** `/api/dev/myloans/api/dms/v1/...`, the same paths as the contract.
  - It answers only while `MYLOANS_MODE=mock` outside production (404 otherwise; production refuses to start in mock mode anyway).
  - It is machine to machine: no session, a Bearer key. The key is `MYLOANS_API_KEY` when set, else the fixed local value `local-mock-key`.
- **Data:** its own tables, `MockMyLoansTxn`, `MockMyLoansProduct` and `MockMyLoansBranch` (migration 022).
  - When empty, they are filled from the sample loans: the built-in samples and the Manual Test Kit's PNs.
  - FeedState, freshness and the 17-field hash follow round 3 (`lib/myloans/r2`).
- **Banner:** while the mock is on, every page shows **"MOCK myloans data"**.

## Settings, System: myloans mock

Needs "Change system switches". It is hidden and refused in production, and refused while the mock is off. Every change is audited.

- **Failure switches:** which call (every call, API 1, API 2, the pool mode, API 4, API 5) and how it fails:
  - Unavailable (503);
  - Slow (longer than the timeout);
  - Busy (429 with Retry-After);
  - Server error (500);
  - Wrong key (401);
  - Malformed answer (a field missing);
  - Page N of a run fails.

  Each switch is for the next call only, or until it is switched off.
- **Scenarios:**
  - cancel then redo;
  - redo without a cancellation;
  - redo chain of 3;
  - NotReleased;
  - duplicate row;
  - two records for one PN (409);
  - exactly 500 changed loans;
  - 501 for the pool mode;
  - product rename;
  - branch rename;
  - timestamp-only change.
- **Reset the mock data:** back to the sample loans, every failure off.

## Contract tests

`tests/contract/myloans.contract.test.ts`, the same checks for every target:

| Target | How | When |
|---|---|---|
| mock | part of `npm test`, in-process | every run |
| local | `npm run test:contract -- --target=local` (a running app; `MYLOANS_MOCK_URL`) | by hand |
| staging | `npm run test:contract -- --target=staging` with `MYLOANS_CONTRACT_URL` and `MYLOANS_CONTRACT_KEY` set **in the shell** (never in a file in the repo); optional `MYLOANS_CONTRACT_PN_OK`, `_PN_CANCELLED`, `_PN_REDONE`, `_PN_MULTI`, `_SINCE`, `_LIMIT` (50 by default) | **by hand only**, read-only GETs, never in CI until staging access (C5); this is the "Real API verification" item |

The checks:
- the shapes of API 1, 2, 4 and 5 and the pool mode;
- API 1 404, 200, 422 (with FeedState and Replaced by) and 409;
- pages cut by loan, ordered by ExternalLoanId and after `afterId`;
- one RunStartedAt per page;
- `nextAfterId` on a full page, null on a short one;
- the pool mode only Released loans on or after the cutoff;
- 401 with a wrong key.

A check that needs a case only the mock can make is skipped on staging unless its PN is given.

## Not in piece 6

- **Find loan and Refresh** still use the old adapter (`lib/myloans/index.ts`). They move onto API 1 in **piece 10a** (PN # search and the Search Log). Today's screens also read fields that are not in the agreed contract (vehicle, address, contact number, previous PN). Moving them is a decision for 10a, not a plain swap.
- **The sync on API 2** is piece 7. **Applying branches and products** is piece 11.
