/* =====================================================================
   REFERENCE ONLY. Round 3 read-only check (cancel / deactivate vs updated_at).
   Received from the myloans team, round 3 (17 Nov 2026). The DMS NEVER runs
   this: it lives here so the DMS mock and sync follow the same contract.
   Real-looking PN # values are replaced with <SAMPLE-PN>; the GD999... PNs
   in the hash test vectors are myloans' own fake data and stay as sent.
   ===================================================================== */

/* =====================================================================
   Round 3 check: does cancelling / deactivating a transaction update
   Transactions.updated_at? (DMS question 1). Read-only.

   Already known from earlier results: a REDO does not. In 22 of 29
   superseded copies, updated_at is earlier than the "x<timestamp>"
   suffix time. The query now covers that with the suffix time and
   the replacement's created_at.

   This looks at the audit trail for the cancelled and inactive
   released loans and compares each audit entry's time with updated_at.
   ===================================================================== */

SET NOCOUNT ON;

SELECT
    T.id,
    T.transaction_status_id,
    T.is_active,
    T.updated_at                         AS TransactionUpdatedAt,
    A.created_at                         AS AuditAt,
    A.module_id, A.action_id, A.description,
    A.old_value, A.new_value,
    CASE WHEN A.created_at > T.updated_at THEN 'AUDIT AFTER updated_at' ELSE '' END AS Flag
FROM MYLMSDB.dbo.Transactions T
JOIN MYLMSDB.dbo.AuditTrailTransactions ATT ON ATT.transaction_id = T.id
JOIN MYLMSDB.dbo.AuditTrails A              ON A.id = ATT.audit_trail_id
WHERE (T.transaction_status_id = 14 OR (T.transaction_status_id = 12 AND T.is_active = 0))
  AND EXISTS (SELECT 1 FROM MYLMSDB.dbo.TransactionPdcDetails P
              WHERE P.transaction_id = T.id AND P.loan_released_date IS NOT NULL)
ORDER BY T.id, A.created_at;
/* WHAT GOOD LOOKS LIKE: the LAST audit entry about the cancel /
   deactivate has the same time as TransactionUpdatedAt (within a
   second or two). Any "AUDIT AFTER updated_at" row on a status or
   is_active change means that change did not touch updated_at. */
