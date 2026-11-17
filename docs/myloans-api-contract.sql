/* =====================================================================
   REFERENCE ONLY. Agreed target API query (round 2). Agreed target, reference only, never run by DMS.
   Received from the myloans team, round 2 (17 Nov 2026). The DMS NEVER runs
   this: it lives here so the DMS mock and sync follow the same contract.
   Real-looking PN # values are replaced with <SAMPLE-PN>; the GD999... PNs
   in the hash test vectors are myloans' own fake data and stay as sent.
   ===================================================================== */

/* =====================================================================
   MyLoans API query (runs behind the MyLoans API, never from DMS)
   Version: round 2 (17 Nov 2026)

   Three calls, one query. Set ONE of @PNNo / @Since / @ReleasedSince.

   API 1  PN # search (LA screen; also the DMS "refresh" button) -> @PNNo
          Returns every row for that PN #, any status. No row = not found.
          Not selectable = IsSelectable 0; FeedState says why, and
          ReplacedByPNNo names the new PN # if the loan was redone.

   API 2  Change feed (every 30 min)                    -> @Since
          Every loan that was EVER RELEASED (has a ReleaseDate) and changed
          after @Since, in ANY FeedState. Never-released transactions are
          never returned. Keep @Since fixed for the whole run.
          Checkpoint = RunStartedAt of the first page minus 5 minutes.

   Pool   Released since go-live (branch pool)          -> @ReleasedSince
          Selectable loans (FeedState = Released) released on/after the date.

   FeedState, 5 values, decided in THIS order (first match wins):
     1. Cancelled    transaction_status_id = 14
     2. Superseded   application_code longer than 20 ("x<timestamp>" copy)
     3. NotReleased  transaction_status_id <> 12
     4. Inactive     is_active = 0
     5. Released     everything else (the only selectable state)

   Paging (API 2 and Pool):
     - Pages are cut by LOAN, not by row: PageRank numbers distinct
       ExternalLoanIds, and a page holds the first @PageSize loans after
       @AfterId. If a loan ever comes back as two rows (a duplicate
       LOANS.CIN), both rows are on the same page.
     - RowsForThisLoan > 1 flags such a duplicate.
     - Next page: @AfterId = the largest ExternalLoanId on this page.
     - Last page: fewer than @PageSize distinct loans (0 = empty page).

   BirthDate: returned ONLY so the API code can compute
     BirthDateHash = HMAC-SHA256(key from API config, 'yyyy-mm-dd')
   The API must drop BirthDate before writing the JSON.

   ContentHash = lowercase hex of SHA-256 over the UTF-16LE bytes of
   HashInput (an nvarchar string; field list in the HI block below).
   Frozen at go-live; any change needs the DMS team and an Admin
   re-baseline.
   ===================================================================== */

DECLARE @PNNo          nvarchar(50)   = NULL;  -- API 1, e.g. N'<SAMPLE-PN>'
DECLARE @Since         datetimeoffset = NULL;  -- API 2, e.g. '2026-11-16T14:00:00+08:00'
DECLARE @ReleasedSince datetimeoffset = NULL;  -- Pool,  e.g. '2027-01-04T00:00:00+08:00'
DECLARE @AfterId       bigint         = 0;     -- paging: largest ExternalLoanId received
DECLARE @PageSize      int            = 500;   -- loans per page

DECLARE @RunStartedAt  datetimeoffset = SYSDATETIMEOFFSET();  -- API returns this

WITH LoanComputationsAgg AS (
    SELECT
        LC.transaction_id,
        SUM(LC.total_loan_amount) AS TotalLoanAmount,
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

Feed AS (
    SELECT
        @RunStartedAt                 AS RunStartedAt,

        /* Identity. DMS links loans on CIN (base code, survives a redo). */
        CAST(T.id AS bigint)          AS ExternalLoanId,
        LEFT(T.application_code, 20)  AS CIN,
        T.pn_no                       AS PNNo,
        T.transaction_status_id       AS TransactionStatusId,
        T.is_active                   AS TransactionIsActive,
        FS.FeedState,                 -- Cancelled / Superseded / NotReleased / Inactive / Released
        CASE WHEN FS.FeedState = 'Released' THEN 1 ELSE 0 END AS IsSelectable,

        /* Redo: the live transaction that replaced this one */
        CAST(RPL.ReplacedByExternalLoanId AS bigint) AS ReplacedByExternalLoanId,
        RPL.ReplacedByPNNo,

        /* Borrower. Empty name parts are sent as NULL. */
        B.cifNo                       AS CIFNo,
        NULLIF(B.FirstName,  N'')     AS FirstName,
        NULLIF(B.MiddleName, N'')     AS MiddleName,
        NULLIF(B.LastName,   N'')     AS LastName,
        NULLIF(B.Suffix,     N'')     AS Suffix,
        B.BirthDate,                  -- API: HMAC it, then DROP before JSON

        /* Loan */
        L.LoanID,
        L.LoanClass                   AS LoanTypeId,
        PRC.Name                      AS LoanType,      -- New / Renewal
        NULLIF(L.CompanyName, N'')    AS BorrowerCompanyName,

        /* Released amount / date. API sends the amount as a string. */
        LCA.TotalLoanAmount,
        SWITCHOFFSET(PDC.ReleaseDate, '+08:00') AS ReleaseDate,

        /* Product (DMS classifies Financing/Refinancing from the name) */
        P.ProductID,
        P.ProductCode,
        P.Name AS ProductName,

        /* Organization */
        C.CompanyID,
        C.Name   AS CompanyName,
        DIV.DivisionId,
        DIV.Name AS DivisionName,
        A.AreaId,
        A.Name   AS AreaName,
        BR.BranchID,
        BR.Code  AS BranchCode,
        BR.Name  AS BranchName,

        /* Freshness */
        Freshness.SourceUpdatedAt,

        /* Change test */
        LOWER(CONVERT(char(64), HASHBYTES('SHA2_256', HI.HashInput), 2)) AS ContentHash,

        /* Paging: number LOANS, not rows */
        DENSE_RANK() OVER (ORDER BY T.id)        AS PageRank,
        COUNT(*)     OVER (PARTITION BY T.id)    AS RowsForThisLoan

    FROM MYLMSDB.dbo.Transactions T

    CROSS APPLY (
        SELECT CASE
            WHEN T.transaction_status_id = 14  THEN 'Cancelled'
            WHEN LEN(T.application_code) > 20  THEN 'Superseded'
            WHEN T.transaction_status_id <> 12 THEN 'NotReleased'
            WHEN T.is_active = 0               THEN 'Inactive'
            ELSE 'Released'
        END AS FeedState
    ) FS

    LEFT JOIN LoanComputationsAgg LCA ON LCA.transaction_id = T.id
    LEFT JOIN PdcAgg PDC              ON PDC.transaction_id = T.id

    /* Newest other transaction with the same base CIN and no suffix.
       Needs an index on Transactions.application_code. */
    OUTER APPLY (
        SELECT TOP 1
            T2.id    AS ReplacedByExternalLoanId,
            T2.pn_no AS ReplacedByPNNo
        FROM MYLMSDB.dbo.Transactions T2
        WHERE LEN(T.application_code) > 20
          AND T2.application_code = LEFT(T.application_code, 20)
          AND T2.id <> T.id
        ORDER BY T2.id DESC
    ) RPL

    /* Full code: a superseded copy never picks up the live loan's LOS data */
    LEFT JOIN MYLOSDB.dbo.LOANS L
        ON L.CIN COLLATE SQL_Latin1_General_CP1_CI_AS
         = T.application_code COLLATE SQL_Latin1_General_CP1_CI_AS

    /* Loan type: LoanClass -> PR_REFERENCES (typeID 50: '7' New, '8' Renewal) */
    LEFT JOIN MYLOSDB.dbo.PR_REFERENCES PRC
        ON PRC.typeID = 50
       AND PRC.Code = CONVERT(nvarchar(10), L.LoanClass)

    LEFT JOIN MYLOSDB.dbo.BORROWERS B      ON B.cifNo = L.cifNo
    LEFT JOIN MYLOSDB.dbo.PR_PRODUCTS P
        ON P.ProductCode COLLATE SQL_Latin1_General_CP1_CI_AS
         = T.product_code COLLATE SQL_Latin1_General_CP1_CI_AS
    LEFT JOIN MYLOSDB.dbo.PR_BRANCHES BR   ON BR.BranchID = T.branch_id
    LEFT JOIN MYLOSDB.dbo.PR_AREAS A       ON A.AreaId = BR.AreaId
    LEFT JOIN MYLOSDB.dbo.PR_DIVISIONS DIV ON DIV.DivisionId = A.DivisionId
    LEFT JOIN MYLOSDB.dbo.PR_COMPANIES C   ON C.CompanyID = BR.CompanyID

    CROSS APPLY (
        SELECT MAX(V.SourceTimestamp) AS SourceUpdatedAt
        FROM (VALUES
            (SWITCHOFFSET(T.updated_at, '+08:00')),
            (SWITCHOFFSET(PDC.PdcUpdatedAt, '+08:00')),
            (SWITCHOFFSET(LCA.LoanComputationUpdatedAt, '+08:00')),
            (TODATETIMEOFFSET(L.UpdatedOn, '+08:00')),
            (TODATETIMEOFFSET(B.UpdatedOn, '+08:00'))
        ) V(SourceTimestamp)
    ) Freshness

    /* HashInput. FROZEN at go-live. 18 fields, '|' between them,
       NULL = empty text. Keep myloans_hash_test_vectors.sql in step. */
    CROSS APPLY (
        SELECT CONCAT(
            FS.FeedState,                                                   '|',  --  1
            CONVERT(nvarchar(200), T.pn_no)       COLLATE DATABASE_DEFAULT, '|',  --  2
            T.transaction_status_id,                                        '|',  --  3
            T.is_active,                                                    '|',  --  4
            CONVERT(nvarchar(200), B.cifNo)       COLLATE DATABASE_DEFAULT, '|',  --  5
            CONVERT(nvarchar(200), B.FirstName)   COLLATE DATABASE_DEFAULT, '|',  --  6
            CONVERT(nvarchar(200), B.MiddleName)  COLLATE DATABASE_DEFAULT, '|',  --  7
            CONVERT(nvarchar(200), B.LastName)    COLLATE DATABASE_DEFAULT, '|',  --  8
            CONVERT(nvarchar(200), B.Suffix)      COLLATE DATABASE_DEFAULT, '|',  --  9
            CONVERT(varchar(30), B.BirthDate, 126),                         '|',  -- 10
            L.LoanID,                                                       '|',  -- 11
            L.LoanClass,                                                    '|',  -- 12
            CONVERT(nvarchar(200), L.CompanyName) COLLATE DATABASE_DEFAULT, '|',  -- 13
            LCA.TotalLoanAmount,                                            '|',  -- 14
            CONVERT(varchar(40), SWITCHOFFSET(PDC.ReleaseDate, '+08:00'), 126), '|', -- 15
            CONVERT(nvarchar(200), P.ProductCode) COLLATE DATABASE_DEFAULT, '|',  -- 16
            BR.BranchID,                                                    '|',  -- 17
            RPL.ReplacedByExternalLoanId                                          -- 18
        ) AS HashInput
    ) HI

    WHERE
        /* API 1: one PN #, any status */
        (@PNNo IS NOT NULL AND T.pn_no = @PNNo)
     OR
        (@PNNo IS NULL
         AND T.id > @AfterId
         AND (
               /* API 2: ever released, any status, changed since @Since */
               (@Since IS NOT NULL
                AND PDC.ReleaseDate IS NOT NULL
                AND Freshness.SourceUpdatedAt > @Since)
            OR
               /* Pool: selectable, released on/after the go-live cutoff */
               (@Since IS NULL AND @ReleasedSince IS NOT NULL
                AND FS.FeedState = 'Released'
                AND PDC.ReleaseDate >= @ReleasedSince)
             ))
)

SELECT *
FROM Feed
WHERE @PNNo IS NOT NULL            -- API 1: all rows for the PN #
   OR PageRank <= @PageSize        -- API 2 / Pool: first @PageSize loans
ORDER BY ExternalLoanId
OPTION (RECOMPILE);
