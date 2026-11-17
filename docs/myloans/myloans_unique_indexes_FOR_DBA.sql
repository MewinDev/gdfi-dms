/* =====================================================================
   REFERENCE ONLY. Index changes for the myloans DBA; never run by the DMS.
   Received from the myloans team, round 2 (17 Nov 2026). The DMS NEVER runs
   this: it lives here so the DMS mock and sync follow the same contract.
   Real-looking PN # values are replaced with <SAMPLE-PN>; the GD999... PNs
   in the hash test vectors are myloans' own fake data and stay as sent.
   ===================================================================== */

/* =====================================================================
   FOR THE MYLOANS DBA ONLY. THIS SCRIPT CHANGES THE DATABASE.
   Do not run without the myloans team's approval and a change ticket.
   Run myloans_round2_checks.sql (R2-1, R2-2) first: these only work if
   ExtraDuplicateRows = 0 for both columns.

   Purpose (DMS round 2, items 3 and 4):
     - enforce one LOANS row per CIN and one transaction per PN #;
     - give the "replaced by" lookup and the PN # search an index.
   Filtered (WHERE ... IS NOT NULL) so rows without a CIN / PN # are allowed.
   ONLINE = ON needs Enterprise edition; remove it on Standard and run
   off-peak, since the build then locks the table.
   ===================================================================== */

-- 1. One LOANS row per CIN
CREATE UNIQUE NONCLUSTERED INDEX UX_LOANS_CIN
    ON MYLOSDB.dbo.LOANS (CIN)
    WHERE CIN IS NOT NULL
    WITH (ONLINE = ON);

-- 2. One transaction per PN #
CREATE UNIQUE NONCLUSTERED INDEX UX_Transactions_pn_no
    ON MYLMSDB.dbo.Transactions (pn_no)
    WHERE pn_no IS NOT NULL
    WITH (ONLINE = ON);

-- 3. Lookup by application_code (skip if R2-1 already shows one).
--    Not unique: it's only for speed. Won't work if application_code is
--    nvarchar(max); in that case ask the developers to change the type.
CREATE NONCLUSTERED INDEX IX_Transactions_application_code
    ON MYLMSDB.dbo.Transactions (application_code)
    INCLUDE (pn_no)
    WITH (ONLINE = ON);
