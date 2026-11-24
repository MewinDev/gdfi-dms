# 06 Product classification

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

v2 Rule 1: a loan is Financing or Refinancing from its myloans product name. The DMS uses keyword lists (D-027, D-031, D-049, D-052) and a per-product override set by hand with a reason. The LA Supervisor/Head keeps the keywords; the LA sees the result on the preview card.

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Rule 1 from the product name; neither word or blank = Refinancing (Changed by D-031 / D-049: keyword lists instead of exactly "Financing"/"Refinancing"; "brand new" and "2nd hand" are Financing) | ✅ Built | Find loan preview | System | Yes (keywords) | `lib/rules/classify.ts`, `classify.test.ts` | Preview of an "Auto Financing" PN says Financing |
| 2 | Keyword lists with whole-word option; Check a product name | ✅ Built | Settings, Product classification | `settings:classification` (LA Supervisor/Head) | Yes | D-052, e2e `settings-modal.spec.ts` | UAT ADM-9 |
| 3 | A product set by hand (Financing / Refinancing) with a reason and history; survives a myloans rename | ✅ Built | Settings, Product classification, Manage product classification | `settings:classification` | Yes | D-049, `getClassificationRules` | Set one product by hand |
| 4 | Products from myloans (API 5), read daily; new product notice | ✅ Built (mock) | Settings, Product classification; Admin Home | n/a | No | D-054, `lib/services/products.ts` | Add a product in the mock: notice shows |
| 5 | "Classification changed since accepted" and Reclassify on an open loan file | ✅ Built | Loan file | `loans:reclassify` (LA Supervisor/Head) | No | D-031 | Change a keyword, open an older file |
| 6 | Override an automatic result (classification, transactions) with a reason | ✅ Built (Changed by D-028: `rules:override`, not v2's `loans:correct_completed_steps`) | Loan file | `rules:override` | No | `lib/services/workflow.ts` | Override, read the history |
| 7 | "Classified by default" label and filter | ✅ Built | Settings, Product classification | n/a | No | D-052 | Filter the products list |

## D. Known limits and open questions

- v2 §13.7: do non-vehicle products (for example Personal loans) need a filter before classification? Not built; today they classify by keyword like any product.
