/* =====================================================================
   REFERENCE ONLY. ContentHash test vectors (fake data).
   Received from the myloans team, round 3 (17 Nov 2026). The DMS NEVER runs
   this: it lives here so the DMS mock and sync follow the same contract.
   Real-looking PN # values are replaced with <SAMPLE-PN>; the GD999... PNs
   in the hash test vectors are myloans' own fake data and stay as sent.
   ===================================================================== */

/* =====================================================================
   ContentHash test vectors for the DMS mock (fake data, safe to share)
   Round 3: 17 fields (no birth date). Same formula as the HI block in
   myloans_api_query.sql. Keep the two in step.

   The fake values are stored in a #temp table whose columns are COPIED
   from the real myloans columns (SELECT TOP 0 ... INTO), so every value
   is converted to text exactly as a real loan would be: same cifNo type,
   same amount scale, same release-date precision.
   Writes only to tempdb. Reads no loan data.

   The DMS mock must:
     1. build HashInput exactly as shown;
     2. encode it as UTF-16LE (SQL nvarchar);
     3. SHA-256 it and write lowercase hex (64 chars, no 0x).
   Send the DMS team the three rows this returns.
   ===================================================================== */

SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#v') IS NOT NULL DROP TABLE #v;

/* Empty table with the real column types (the join stops SQL Server
   copying IDENTITY, so fake ids can be inserted) */
SELECT TOP 0
    CAST('' AS varchar(40))  AS Vector,
    CAST('' AS varchar(12))  AS FeedState,
    T.pn_no,
    T.transaction_status_id,
    T.is_active,
    B.cifNo,
    B.FirstName,
    B.MiddleName,
    B.LastName,
    B.Suffix,
    L.LoanID,
    L.LoanClass,
    L.CompanyName,
    LC.total_loan_amount     AS TotalLoanAmount,
    PDC.loan_released_date   AS ReleaseDate,
    P.ProductCode,
    BR.BranchID,
    T.id                     AS ReplacedById
INTO #v
FROM MYLMSDB.dbo.Transactions T
CROSS JOIN MYLMSDB.dbo.LoanComputations LC
CROSS JOIN MYLMSDB.dbo.TransactionPdcDetails PDC
CROSS JOIN MYLOSDB.dbo.LOANS L
CROSS JOIN MYLOSDB.dbo.BORROWERS B
CROSS JOIN MYLOSDB.dbo.PR_PRODUCTS P
CROSS JOIN MYLOSDB.dbo.PR_BRANCHES BR;

INSERT INTO #v VALUES
-- 1. Plain released loan; NULL suffix; enye in the middle name
('1 Released',    'Released',  N'GD9990000000001', 12, 1, 900001,
 N'Juan', N'Peña', N'Dela Cruz', NULL,
 990001, 7, N'Acme Trading', 250000.00, '2026-11-02T10:30:00.0000000+08:00',
 N'01-PDL', 404, NULL),
-- 2. Renewal, release time stored as +00:00 (hashed in +08:00)
('2 Renewal UTC', 'Released',  N'GD9990000000002', 12, 1, 900002,
 N'Maria', NULL, N'Santos', N'Jr.',
 990002, 8, NULL, 1000000.50, '2026-04-15T07:32:54.8170000+00:00',
 N'01-PCREF', 290, NULL),
-- 3. Cancelled then redone: replaced by transaction 99999; no LOS data
('3 Cancelled',   'Cancelled', N'GD9990000000003', 14, 1, NULL,
 NULL, NULL, NULL, NULL,
 NULL, NULL, NULL, 524300.00, '2026-07-31T20:26:47.4880000+08:00',
 N'01-SCREF', 181, 99999);

SELECT
    Vector,
    HI.HashInput,
    LOWER(CONVERT(char(64), HASHBYTES('SHA2_256', HI.HashInput), 2)) AS ContentHash
FROM #v
CROSS APPLY (
    SELECT CONCAT(
        FeedState,                                                   '|',  --  1
        CONVERT(nvarchar(200), pn_no)       COLLATE DATABASE_DEFAULT, '|',  --  2
        transaction_status_id,                                       '|',  --  3
        is_active,                                                   '|',  --  4
        CONVERT(nvarchar(200), cifNo)       COLLATE DATABASE_DEFAULT, '|',  --  5
        CONVERT(nvarchar(200), FirstName)   COLLATE DATABASE_DEFAULT, '|',  --  6
        CONVERT(nvarchar(200), MiddleName)  COLLATE DATABASE_DEFAULT, '|',  --  7
        CONVERT(nvarchar(200), LastName)    COLLATE DATABASE_DEFAULT, '|',  --  8
        CONVERT(nvarchar(200), Suffix)      COLLATE DATABASE_DEFAULT, '|',  --  9
        LoanID,                                                      '|',  -- 10
        LoanClass,                                                   '|',  -- 11
        CONVERT(nvarchar(200), CompanyName) COLLATE DATABASE_DEFAULT, '|',  -- 12
        TotalLoanAmount,                                             '|',  -- 13
        CONVERT(varchar(40), SWITCHOFFSET(ReleaseDate, '+08:00'), 126), '|',  -- 14
        CONVERT(nvarchar(200), ProductCode) COLLATE DATABASE_DEFAULT, '|',  -- 15
        BranchID,                                                    '|',  -- 16
        ReplacedById                                                        -- 17
    ) AS HashInput
) HI
ORDER BY Vector;

DROP TABLE #v;
