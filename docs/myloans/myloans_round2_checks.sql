/* =====================================================================
   REFERENCE ONLY. Read-only checks myloans runs on their side.
   Received from the myloans team, round 2 (17 Nov 2026). The DMS NEVER runs
   this: it lives here so the DMS mock and sync follow the same contract.
   Real-looking PN # values are replaced with <SAMPLE-PN>; the GD999... PNs
   in the hash test vectors are myloans' own fake data and stay as sent.
   ===================================================================== */

/* =====================================================================
   Checks for the DMS team's round 2 reply (read-only, SELECT only)
   ===================================================================== */

SET NOCOUNT ON;

/* R2-1. Index on Transactions.application_code (their item 3) */
SELECT i.name AS IndexName, i.type_desc, i.is_unique,
       STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS KeyCols
FROM MYLMSDB.sys.indexes i
JOIN MYLMSDB.sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN MYLMSDB.sys.columns c        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.object_id = OBJECT_ID('MYLMSDB.dbo.Transactions')
  AND ic.is_included_column = 0
GROUP BY i.name, i.type_desc, i.is_unique
ORDER BY i.name;
/* Look for an index whose FIRST key column is application_code
   (and one on pn_no). If none, the DBA should add them. */


/* R2-2. Can unique indexes be added? (their item 4)
   Earlier checks covered only released loans. A unique index needs the
   WHOLE table to be duplicate-free. */
SELECT 'LOANS.CIN' AS Col,
       COUNT(*) - COUNT(CIN)          AS NullRows,
       COUNT(CIN) - COUNT(DISTINCT CIN) AS ExtraDuplicateRows
FROM MYLOSDB.dbo.LOANS
UNION ALL
SELECT 'Transactions.pn_no',
       COUNT(*) - COUNT(pn_no),
       COUNT(pn_no) - COUNT(DISTINCT pn_no)
FROM MYLMSDB.dbo.Transactions;
/* ExtraDuplicateRows must be 0 for a (filtered) unique index. */

-- If not 0, list them
SELECT TOP 50 CIN, COUNT(*) AS Cnt FROM MYLOSDB.dbo.LOANS
WHERE CIN IS NOT NULL GROUP BY CIN HAVING COUNT(*) > 1;
SELECT TOP 50 pn_no, COUNT(*) AS Cnt FROM MYLMSDB.dbo.Transactions
WHERE pn_no IS NOT NULL GROUP BY pn_no HAVING COUNT(*) > 1;


/* R2-3. Products: columns, then the list for the DMS keyword setup
   (save the second result as a CSV and send it) */
SELECT COLUMN_NAME, DATA_TYPE
FROM MYLOSDB.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'PR_PRODUCTS'
ORDER BY ORDINAL_POSITION;

SELECT * FROM MYLOSDB.dbo.PR_PRODUCTS ORDER BY ProductCode;


/* R2-4. Where is "fully paid / closed"? (their REQUIRED item)
   Status 50 "Closed" exists in TransactionStatuses, but no transaction
   used it on 16 Nov. So the paid state probably lives elsewhere. */
SELECT 'MYLMSDB' AS Db, TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM MYLMSDB.INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%paid%'    OR COLUMN_NAME LIKE '%closed%'
   OR COLUMN_NAME LIKE '%close%'   OR COLUMN_NAME LIKE '%settle%'
   OR COLUMN_NAME LIKE '%balance%' OR COLUMN_NAME LIKE '%matur%'
   OR COLUMN_NAME LIKE '%fully%'   OR COLUMN_NAME LIKE '%account_status%'
UNION ALL
SELECT 'MYLOSDB', TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM MYLOSDB.INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%paid%'    OR COLUMN_NAME LIKE '%closed%'
   OR COLUMN_NAME LIKE '%close%'   OR COLUMN_NAME LIKE '%settle%'
   OR COLUMN_NAME LIKE '%balance%' OR COLUMN_NAME LIKE '%matur%'
   OR COLUMN_NAME LIKE '%fully%'
ORDER BY 1, 2, 3;

-- Is status 50 "Closed" used anywhere on Transactions?
SELECT COUNT(*) AS ClosedTransactions
FROM MYLMSDB.dbo.Transactions
WHERE transaction_status_id = 50;


/* R2-5. Types behind the hash fields (so the test vectors match) */
SELECT 'MYLMSDB' AS Db, TABLE_NAME, COLUMN_NAME, DATA_TYPE,
       NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION
FROM MYLMSDB.INFORMATION_SCHEMA.COLUMNS
WHERE (TABLE_NAME = 'Transactions' AND COLUMN_NAME IN ('pn_no','transaction_status_id','is_active','id'))
   OR (TABLE_NAME = 'LoanComputations' AND COLUMN_NAME = 'total_loan_amount')
   OR (TABLE_NAME = 'TransactionPdcDetails' AND COLUMN_NAME = 'loan_released_date')
UNION ALL
SELECT 'MYLOSDB', TABLE_NAME, COLUMN_NAME, DATA_TYPE,
       NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION
FROM MYLOSDB.INFORMATION_SCHEMA.COLUMNS
WHERE (TABLE_NAME = 'BORROWERS' AND COLUMN_NAME IN ('cifNo','BirthDate'))
   OR (TABLE_NAME = 'LOANS' AND COLUMN_NAME IN ('LoanID','LoanClass'))
   OR (TABLE_NAME = 'PR_BRANCHES' AND COLUMN_NAME = 'BranchID');


/* R2-6. Timing (their C1). Open myloans_api_query.sql, put these two
   lines at the very top, and run it three times:
     a) @Since = 30 minutes ago     (one API 2 page)
     b) @ReleasedSince = '2026-11-01T00:00:00+08:00'   (Pool)
     c) @PNNo = N'<SAMPLE-PN>'  (API 1)
   Send the "SQL Server Execution Times: elapsed time" of each. */
-- SET STATISTICS TIME ON;
-- SET STATISTICS IO ON;
