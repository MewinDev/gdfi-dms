/* =====================================================================
   SAVED BY THE DMS TEAM, 16 November 2026 (PHT)
   Source: the project owner's MyLoans API query, pasted on 16 Nov 2026.
   REFERENCE ONLY. NEVER EXECUTED BY THE DMS. The DMS calls the MyLoans
   API; this query runs behind that API, on the MyLoans side.
   One change from the pasted text: the sample PN # used for the time-zone
   check was replaced by <SAMPLE-PN> (no real PN #s in this repository).
   ===================================================================== */

/* =====================================================================
   MyLoans API query (backs the DMS loan API calls)

   Per the DMS BRD, DMS never reads the MyLoans database directly.
   This query runs BEHIND the MyLoans API, on the MyLoans side.

   MODES - set exactly ONE of @PNNo or @Since:

   A) PN # search / freshness check     -> @PNNo = '<PN #>', @Since = NULL
      Returns 1 row (or none). This is why a test with @PNNo filled in
      shows only one PN #.
        API 1  GET /api/dms/v1/loans/{pnNo}
               no row            -> 404 not found
               IsSelectable = 0  -> 422 with TransactionStatusId (no loan data)
               IsSelectable = 1  -> 200 with the loan
        API 3  GET /api/dms/v1/loans/{pnNo}/freshness
               API returns only PNNo, TransactionStatusId,
               TransactionIsActive, SourceUpdatedAt, ContentHash

   B) Change check (paged)              -> @PNNo = NULL, @Since = checkpoint
      Returns ALL loans changed after @Since - many PN #s, ANY status
      (no Released/active filter), so DMS also sees loans that were
      cancelled or are no longer Released in MyLoans.
        API 2  GET /api/dms/v1/loans/changes?since=...&cursor=...&limit=500
      Checkpoint rule (BRD): @Since = maxSourceUpdatedAt from the last
      SUCCESSFUL run minus 5 minutes. If a run fails, keep the old
      checkpoint. Paging: pass the last row's SourceUpdatedAt and
      ExternalLoanId as @CursorAt / @CursorId for the next page; the
      last page is the one with fewer than @Limit rows.

   Calling with both NULL (or both set) is refused - it would return
   every loan (about 12,998).
   ===================================================================== */

DECLARE @PNNo     nvarchar(50)   = NULL;        -- Mode A, e.g. N'<SAMPLE-PN>'
DECLARE @Since    datetimeoffset = '2026-11-16T08:55:00+08:00';  -- Mode B checkpoint
DECLARE @CursorAt datetimeoffset = NULL;        -- Mode B, next page only
DECLARE @CursorId bigint         = NULL;        -- Mode B, next page only
DECLARE @Limit    int            = 500;         -- BRD paging limit

IF (@PNNo IS NULL AND @Since IS NULL) OR (@PNNo IS NOT NULL AND @Since IS NOT NULL)
BEGIN
    RAISERROR('Set exactly one of @PNNo (PN # search) or @Since (change check).', 16, 1);
    RETURN;
END;

/* Page start: first page = rows after @Since; later pages = rows after the cursor */
DECLARE @AfterAt datetimeoffset = COALESCE(@CursorAt, @Since);
DECLARE @AfterId bigint         = CASE WHEN @CursorAt IS NULL
                                       THEN 9223372036854775807   -- first page: strictly after @Since
                                       ELSE @CursorId END;

WITH LoanComputationsAgg AS (
    SELECT
        LC.transaction_id,
        SUM(LC.total_loan_amount) AS TotalLoanAmount,     -- confirm: total released amount (Mortgage rule)
        MAX(LC.updated_at)        AS LoanComputationUpdatedAt
    FROM MYLMSDB.dbo.LoanComputations LC
    GROUP BY LC.transaction_id
),
PdcAgg AS (
    SELECT
        PDC.transaction_id,
        MAX(PDC.loan_released_date) AS ReleaseDate,
        MAX(PDC.updated_at)         AS PdcUpdatedAt
    FROM MYLMSDB.dbo.TransactionPdcDetails PDC
    GROUP BY PDC.transaction_id
),
Loans AS (
    SELECT
        T.id                          AS ExternalLoanId,
        LEFT(T.application_code, 20)  AS CIN,
        T.pn_no                       AS PNNo,
        T.transaction_status_id       AS TransactionStatusId,
        T.is_active                   AS TransactionIsActive,
        CASE WHEN LEN(T.application_code) > 20 THEN 1 ELSE 0 END AS IsSuperseded,  -- "x<timestamp>" copy
        CASE WHEN T.transaction_status_id = 12
              AND T.is_active = 1
              AND LEN(T.application_code) <= 20
             THEN 1 ELSE 0 END        AS IsSelectable,                              -- released + active

        /* Borrower */
        B.cifNo       AS CIFNo,
        B.FirstName   AS BorrowerFirstName,
        B.MiddleName  AS BorrowerMiddleName,
        B.LastName    AS BorrowerLastName,
        B.Suffix      AS BorrowerSuffix,
        B.BirthDate,

        /* Loan */
        L.LoanID,
        PRC.Name      AS LoanType,                 -- New / Renewal
        L.CompanyName AS BorrowerCompanyName,
        LCA.TotalLoanAmount,
        CONVERT(date, SWITCHOFFSET(PDC.ReleaseDate, '+08:00')) AS ReleaseDate,  -- Manila date (source is +00:00)

        /* Product and branch (names come from the branches/products APIs) */
        P.ProductCode,
        P.Name        AS ProductName,
        T.branch_id   AS BranchID,

        /* Cheap pre-filter for polling */
        Freshness.SourceUpdatedAt,

        /* Real change test: monitored fields only; NULL kept distinct from '' */
        HASHBYTES('SHA2_256', CONCAT(
            COALESCE(CONVERT(nvarchar(200), T.pn_no) COLLATE DATABASE_DEFAULT, N'~'),       N'|',
            COALESCE(CONVERT(nvarchar(20),  T.transaction_status_id), N'~'),                N'|',
            COALESCE(CONVERT(nvarchar(5),   T.is_active), N'~'),                            N'|',
            COALESCE(CONVERT(nvarchar(200), T.application_code) COLLATE DATABASE_DEFAULT, N'~'), N'|',
            COALESCE(CONVERT(nvarchar(200), B.cifNo) COLLATE DATABASE_DEFAULT, N'~'),       N'|',
            COALESCE(CONVERT(nvarchar(200), B.FirstName) COLLATE DATABASE_DEFAULT, N'~'),   N'|',
            COALESCE(CONVERT(nvarchar(200), B.MiddleName) COLLATE DATABASE_DEFAULT, N'~'),  N'|',
            COALESCE(CONVERT(nvarchar(200), B.LastName) COLLATE DATABASE_DEFAULT, N'~'),    N'|',
            COALESCE(CONVERT(nvarchar(200), B.Suffix) COLLATE DATABASE_DEFAULT, N'~'),      N'|',
            COALESCE(CONVERT(nvarchar(30),  B.BirthDate, 126), N'~'),                       N'|',
            COALESCE(CONVERT(nvarchar(50),  L.LoanID), N'~'),                               N'|',
            COALESCE(CONVERT(nvarchar(10),  L.LoanClass), N'~'),                            N'|',
            COALESCE(CONVERT(nvarchar(200), L.CompanyName) COLLATE DATABASE_DEFAULT, N'~'), N'|',
            COALESCE(CONVERT(nvarchar(40),  LCA.TotalLoanAmount), N'~'),                    N'|',
            COALESCE(CONVERT(nvarchar(30),  CONVERT(date, SWITCHOFFSET(PDC.ReleaseDate, '+08:00')), 126), N'~'), N'|',
            COALESCE(CONVERT(nvarchar(200), P.ProductCode) COLLATE DATABASE_DEFAULT, N'~'), N'|',
            COALESCE(CONVERT(nvarchar(20),  T.branch_id), N'~')
        )) AS ContentHash

    FROM MYLMSDB.dbo.Transactions T
    LEFT JOIN LoanComputationsAgg LCA ON LCA.transaction_id = T.id
    LEFT JOIN PdcAgg PDC              ON PDC.transaction_id = T.id
    LEFT JOIN MYLOSDB.dbo.LOANS L
           ON L.CIN COLLATE SQL_Latin1_General_CP1_CI_AS
            = T.application_code COLLATE SQL_Latin1_General_CP1_CI_AS   -- confirm 1 LOANS row per CIN
    /* LOANS.LoanClass -> PR_REFERENCES.Code in typeID 50 (Code '7' = New, '8' = Renewal) */
    LEFT JOIN MYLOSDB.dbo.PR_REFERENCES PRC
           ON PRC.typeID = 50
          AND PRC.Code = CONVERT(nvarchar(10), L.LoanClass)
    LEFT JOIN MYLOSDB.dbo.BORROWERS B
           ON B.cifNo = L.cifNo                                          -- confirm 1 BORROWERS row per cifNo
    LEFT JOIN MYLOSDB.dbo.PR_PRODUCTS P
           ON P.ProductCode COLLATE SQL_Latin1_General_CP1_CI_AS
            = T.product_code COLLATE SQL_Latin1_General_CP1_CI_AS
    CROSS APPLY (
        /* One consistent +08:00 conversion for every source table (BRD).
           Checked against sample PN # <SAMPLE-PN>:
           - Transactions.updated_at is datetimeoffset (+08:00)
           - TransactionPdcDetails / LoanComputations updated_at are
             datetimeoffset in UTC (+00:00); 07:40 UTC = 15:40 Manila, 4 min
             after LOANS.UpdatedOn 15:36, so the +00:00 is real UTC
           - LOANS / BORROWERS UpdatedOn are datetime2 in Manila time
           So SWITCHOFFSET for the first three and TODATETIMEOFFSET for the
           last two is correct. Re-check on a few more loans before go-live. */
        SELECT MAX(V.SourceTimestamp) AS SourceUpdatedAt
        FROM (VALUES
            (SWITCHOFFSET(T.updated_at, '+08:00')),
            (SWITCHOFFSET(PDC.PdcUpdatedAt, '+08:00')),
            (SWITCHOFFSET(LCA.LoanComputationUpdatedAt, '+08:00')),
            (TODATETIMEOFFSET(L.UpdatedOn, '+08:00')),
            (TODATETIMEOFFSET(B.UpdatedOn, '+08:00'))
        ) V(SourceTimestamp)
    ) Freshness
    WHERE
        /* Mode A: one PN #, any status, so the API can explain why */
        (@PNNo IS NOT NULL AND T.pn_no = @PNNo)
     OR
        /* Mode B: every loan changed after the page start, ANY status */
        (@PNNo IS NULL
         AND (   Freshness.SourceUpdatedAt > @AfterAt
              OR (Freshness.SourceUpdatedAt = @AfterAt AND T.id > @AfterId)))
)
SELECT TOP (@Limit) *
FROM Loans
ORDER BY SourceUpdatedAt, ExternalLoanId          -- BRD sort order for paging
OPTION (RECOMPILE);

/* API 2 response per page: rows + nextCursor (last row's SourceUpdatedAt and
   ExternalLoanId, if the page is full) + maxSourceUpdatedAt (last row's
   SourceUpdatedAt). DMS saves maxSourceUpdatedAt as the new checkpoint only
   after every page is processed. Run with READ COMMITTED SNAPSHOT; no NOLOCK. */
