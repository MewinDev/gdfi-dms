/* =============================================================================
   REFERENCE ONLY. NEVER EXECUTED BY THE DMS.

   The MyLoans database team's source query for released loans: the definition of what they
   will expose as a read-only view behind the MyLoans API. The DMS never connects to MYLOSDB
   or MYLMSDB and never runs this. Its column aliases are the names lib/myloans/live-mapping.ts
   maps (see docs/myloans/field-map.md). BirthDate and TitleId are returned here but the DMS
   never reads them.
   ============================================================================= */

WITH LoanComputationsAgg AS (
    SELECT
        LC.transaction_id,
        SUM(LC.total_loan_amount) AS TotalLoanAmount,
        MAX(LC.updated_at) AS LoanComputationUpdatedAt
    FROM MYLMSDB.dbo.LoanComputations LC
    GROUP BY LC.transaction_id
),

PdcAgg AS (
    SELECT
        PDC.transaction_id,
        MAX(PDC.loan_released_date) AS ReleaseDate,
        MAX(PDC.updated_at) AS PdcUpdatedAt
    FROM MYLMSDB.dbo.TransactionPdcDetails PDC
    GROUP BY PDC.transaction_id
)

SELECT
    /* =========================================================
       Transaction
       ========================================================= */

    T.id AS ExternalLoanId,
    LEFT(T.application_code, 20) AS CIN,
    T.pn_no AS PNNo,

    T.transaction_status_id AS TransactionStatusId,
    T.is_active AS TransactionIsActive,


    /* =========================================================
       Borrower
       ========================================================= */

    B.cifNo AS CIFNo,
    B.TitleId,
    B.FirstName,
    B.MiddleName,
    B.LastName,
    B.Suffix,
    B.BirthDate,


    /* =========================================================
       Loan
       ========================================================= */

    L.LoanID,

    /* MyLoans business Loan Type:
       ClassId -> PR_REFERENCES -> New / Renewal
    */
    L.ClassId AS LoanTypeId,
    PRC.Name AS LoanType,

    L.CompanyName AS BorrowerCompanyName,


    /* =========================================================
       Released Amount / Date
       ========================================================= */

    LCA.TotalLoanAmount,
    PDC.ReleaseDate,


    /* =========================================================
       Product
       ========================================================= */

    P.ProductID,
    P.ProductCode,
    P.Name AS ProductName,


    /* =========================================================
       Organization
       ========================================================= */

    C.CompanyID,
    C.Name AS CompanyName,

    DIV.DivisionId,
    DIV.Name AS DivisionName,

    A.AreaId,
    A.Name AS AreaName,

    BR.BranchID,
    BR.Code AS BranchCode,
    BR.Name AS BranchName,


    /* =========================================================
       Source Timestamps
       ========================================================= */

    T.updated_at AS TransactionUpdatedAt,
    PDC.PdcUpdatedAt,
    LCA.LoanComputationUpdatedAt,
    L.UpdatedOn AS LoanUpdatedOn,
    B.UpdatedOn AS BorrowerUpdatedOn,


    /* =========================================================
       Source Freshness
       ========================================================= */

    Freshness.SourceUpdatedAt

FROM MYLMSDB.dbo.Transactions T


/* =============================================================
   Loan Computation
   ============================================================= */

LEFT JOIN LoanComputationsAgg LCA
    ON LCA.transaction_id = T.id


/* =============================================================
   PDC
   ============================================================= */

LEFT JOIN PdcAgg PDC
    ON PDC.transaction_id = T.id


/* =============================================================
   LOS Loan
   ============================================================= */

LEFT JOIN MYLOSDB.dbo.LOANS L
    ON L.CIN COLLATE SQL_Latin1_General_CP1_CI_AS
       =
       LEFT(T.application_code, 20)
       COLLATE SQL_Latin1_General_CP1_CI_AS


/* =============================================================
   Loan Type / Classification

   MyLoans UI:
       Loan Type = New / Renewal

   Source:
       LOANS.ClassId
           ↓
       PR_REFERENCES.refID
           ↓
       PR_REFERENCES.Name
   ============================================================= */

LEFT JOIN MYLOSDB.dbo.PR_REFERENCES PRC
    ON L.ClassId = PRC.refID


/* =============================================================
   Borrower
   ============================================================= */

LEFT JOIN MYLOSDB.dbo.BORROWERS B
    ON B.cifNo = L.cifNo


/* =============================================================
   Product

   Transactions.product_code is authoritative.
   ============================================================= */

LEFT JOIN MYLOSDB.dbo.PR_PRODUCTS P
    ON P.ProductCode COLLATE SQL_Latin1_General_CP1_CI_AS
       =
       T.product_code COLLATE SQL_Latin1_General_CP1_CI_AS


/* =============================================================
   Branch
   ============================================================= */

LEFT JOIN MYLOSDB.dbo.PR_BRANCHES BR
    ON BR.BranchID = T.branch_id


/* =============================================================
   Area
   ============================================================= */

LEFT JOIN MYLOSDB.dbo.PR_AREAS A
    ON A.AreaId = BR.AreaId


/* =============================================================
   Division
   ============================================================= */

LEFT JOIN MYLOSDB.dbo.PR_DIVISIONS DIV
    ON DIV.DivisionId = A.DivisionId


/* =============================================================
   Company
   ============================================================= */

LEFT JOIN MYLOSDB.dbo.PR_COMPANIES C
    ON C.CompanyID = BR.CompanyID


/* =============================================================
   Source Freshness

   The latest meaningful update can come from:
   - Transactions
   - PDC
   - Loan Computations
   - Loan
   - Borrower
   ============================================================= */

CROSS APPLY (
    SELECT MAX(V.SourceTimestamp) AS SourceUpdatedAt
    FROM (
        VALUES
            (
                SWITCHOFFSET(
                    T.updated_at,
                    '+08:00'
                )
            ),
            (
                SWITCHOFFSET(
                    PDC.PdcUpdatedAt,
                    '+08:00'
                )
            ),
            (
                SWITCHOFFSET(
                    LCA.LoanComputationUpdatedAt,
                    '+08:00'
                )
            ),
            (
                CASE
                    WHEN L.UpdatedOn IS NOT NULL
                    THEN TODATETIMEOFFSET(
                        L.UpdatedOn,
                        '+08:00'
                    )
                END
            ),
            (
                CASE
                    WHEN B.UpdatedOn IS NOT NULL
                    THEN TODATETIMEOFFSET(
                        B.UpdatedOn,
                        '+08:00'
                    )
                END
            )
    ) V(SourceTimestamp)
) Freshness


/* =============================================================
   Released Loans

   Status 12 = Loan Released
   ============================================================= */

WHERE T.transaction_status_id = 12;
