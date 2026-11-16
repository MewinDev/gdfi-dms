/* =====================================================================
   AGREED TARGET, REFERENCE ONLY, NEVER RUN BY DMS.
   The DMS calls the myloans API only; this query runs behind that API,
   on the myloans side. Saved 16 November 2026 (PHT) from
   docs/incoming/myloans_api_query.sql, replacing the earlier draft.
   One change from the original: real-looking PN #s were replaced by
   <SAMPLE-PN>. Answers and background: docs/MYLOANS_ANSWERS.md.
   ===================================================================== */

/* =====================================================================
   MyLoans API query (runs behind the MyLoans API, never from DMS)

   Three calls, one query. Set ONE of @PNNo / @Since / @ReleasedSince.

   API 1  PN # search (LA screen)                       -> @PNNo
          Returns that transaction in any status. Not found = no row.
          Not selectable = IsSelectable 0; FeedState says why, and
          ReplacedByPNNo names the new PN # if the loan was redone.

   API 2  Change feed (every 30 min)                    -> @Since
          Every loan that was EVER RELEASED (has a ReleaseDate) and changed
          after @Since, in ANY status: Released, Cancelled (14),
          Inactive, Superseded. DMS needs the non-released ones to raise
          "cancelled" / "replaced" Open Items. Never-released transactions
          (about 18,000) are never returned.
          Keep @Since fixed for the whole run and page with @AfterId.
          Checkpoint = RunStartedAt of the first page minus 5 minutes.

   Pool   Released since go-live (branch pool / first load) -> @ReleasedSince
          Selectable loans (IsSelectable = 1) released on/after the date.
          Older loans enter DMS only through API 1.

   Paging (API 2 and Pool): ORDER BY ExternalLoanId, @AfterId = last id of
   the previous page, @PageSize rows per page. A page with fewer than
   @PageSize rows is the last one.

   BirthDate: returned ONLY so the API code can compute
     BirthDateHash = HMAC-SHA256(key from API config, 'yyyy-mm-dd')
   The API must drop BirthDate before writing the JSON.

   ContentHash: 64 lowercase hex characters. Frozen at go-live; any
   change needs the DMS team and an Admin re-baseline.
   ===================================================================== */

DECLARE @PNNo          nvarchar(50)   = NULL;  -- API 1, e.g. N'<SAMPLE-PN>'
DECLARE @Since         datetimeoffset = NULL;  -- API 2, e.g. '2026-11-16T14:00:00+08:00'
DECLARE @ReleasedSince datetimeoffset = NULL;  -- Pool,  e.g. '2027-01-04T00:00:00+08:00'
DECLARE @AfterId       int            = 0;     -- paging: last ExternalLoanId received
DECLARE @PageSize      int            = 500;

DECLARE @RunStartedAt  datetimeoffset = SYSDATETIMEOFFSET();  -- API returns this on page 1

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
)

SELECT TOP (CASE WHEN @PNNo IS NOT NULL THEN 2 ELSE @PageSize END)
    @RunStartedAt                 AS RunStartedAt,

    /* Identity. DMS links loans on CIN (base code, survives a redo). */
    T.id                          AS ExternalLoanId,
    LEFT(T.application_code, 20)  AS CIN,
    T.pn_no                       AS PNNo,
    T.transaction_status_id       AS TransactionStatusId,
    T.is_active                   AS TransactionIsActive,
    FS.FeedState,                 -- Released / Cancelled / Superseded / Inactive
    CASE WHEN FS.FeedState = 'Released' THEN 1 ELSE 0 END AS IsSelectable,

    /* Redo: the live transaction that replaced this one (superseded rows) */
    RPL.ReplacedByExternalLoanId,
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

    /* Product */
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

    /* Change test: only fields DMS shows or uses (+ birth date,
       which DMS identifies through BirthDateHash). NULL = ''. */
    LOWER(CONVERT(char(64), HASHBYTES('SHA2_256', CONCAT(
        FS.FeedState,                                                '|',
        CONVERT(nvarchar(200), T.pn_no)       COLLATE DATABASE_DEFAULT, '|',
        T.transaction_status_id,                                     '|',
        T.is_active,                                                 '|',
        CONVERT(nvarchar(200), B.cifNo)       COLLATE DATABASE_DEFAULT, '|',
        CONVERT(nvarchar(200), B.FirstName)   COLLATE DATABASE_DEFAULT, '|',
        CONVERT(nvarchar(200), B.MiddleName)  COLLATE DATABASE_DEFAULT, '|',
        CONVERT(nvarchar(200), B.LastName)    COLLATE DATABASE_DEFAULT, '|',
        CONVERT(nvarchar(200), B.Suffix)      COLLATE DATABASE_DEFAULT, '|',
        CONVERT(varchar(30), B.BirthDate, 126),                      '|',
        L.LoanID,                                                    '|',
        L.LoanClass,                                                 '|',
        CONVERT(nvarchar(200), L.CompanyName) COLLATE DATABASE_DEFAULT, '|',
        LCA.TotalLoanAmount,                                         '|',
        CONVERT(varchar(40), SWITCHOFFSET(PDC.ReleaseDate, '+08:00'), 126), '|',
        CONVERT(nvarchar(200), P.ProductCode) COLLATE DATABASE_DEFAULT, '|',
        BR.BranchID
    )), 2)) AS ContentHash

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

/* Newest other transaction with the same base CIN and no suffix */
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
ORDER BY T.id
OPTION (RECOMPILE);