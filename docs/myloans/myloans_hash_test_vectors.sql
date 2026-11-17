/* =====================================================================
   REFERENCE ONLY. ContentHash test vectors (fake data).
   Received from the myloans team, round 2 (17 Nov 2026). The DMS NEVER runs
   this: it lives here so the DMS mock and sync follow the same contract.
   Real-looking PN # values are replaced with <SAMPLE-PN>; the GD999... PNs
   in the hash test vectors are myloans' own fake data and stay as sent.
   ===================================================================== */

/* =====================================================================
   ContentHash test vectors for the DMS mock (fake data, safe to share)
   Same 18-field formula as the HI block in myloans_api_query.sql.
   Keep the two in step.

   The DMS mock must:
     1. build HashInput exactly as shown in the HashInput column;
     2. encode it as UTF-16LE (SQL nvarchar);
     3. SHA-256 it and write lowercase hex (64 chars, no 0x).
   Send the DMS team the three rows this returns.
   ===================================================================== */

SET NOCOUNT ON;

DECLARE @v TABLE (
    Vector            varchar(40),
    FeedState         varchar(12),
    pn_no             nvarchar(50),
    status_id         int,
    is_active         bit,
    cifNo             int,
    FirstName         nvarchar(100),
    MiddleName        nvarchar(100),
    LastName          nvarchar(100),
    Suffix            nvarchar(20),
    BirthDate         date,
    LoanID            int,
    LoanClass         int,
    CompanyName       nvarchar(200),
    TotalLoanAmount   decimal(38, 2),
    ReleaseDate       datetimeoffset(7),
    ProductCode       nvarchar(50),
    BranchID          int,
    ReplacedById      int
);

INSERT INTO @v VALUES
-- 1. Plain released loan; NULL suffix; enye in the name
('1 Released',   'Released',   N'GD9990000000001', 12, 1, 900001,
 N'Juan', N'Peña', N'Dela Cruz', NULL, '1990-01-15',
 990001, 7, N'Acme Trading', 250000.00, '2026-11-02T10:30:00.0000000+08:00',
 N'01-PDL', 404, NULL),
-- 2. Renewal stored with a +00:00 release time (converted to +08:00 in the hash)
('2 Renewal UTC', 'Released',  N'GD9990000000002', 12, 1, 900002,
 N'Maria', NULL, N'Santos', N'Jr.', '1985-07-04',
 990002, 8, NULL, 1000000.50, '2026-04-15T07:32:54.8170000+00:00',
 N'01-PCREF', 290, NULL),
-- 3. Cancelled then redone: replaced by transaction 99999
('3 Cancelled',  'Cancelled',  N'GD9990000000003', 14, 1, NULL,
 NULL, NULL, NULL, NULL, NULL,
 NULL, NULL, NULL, 524300.00, '2026-07-31T20:26:47.4880000+08:00',
 N'01-SCREF', 181, 99999);

SELECT
    Vector,
    HI.HashInput,
    LOWER(CONVERT(char(64), HASHBYTES('SHA2_256', HI.HashInput), 2)) AS ContentHash
FROM @v
CROSS APPLY (
    SELECT CONCAT(
        FeedState,                                                   '|',
        CONVERT(nvarchar(200), pn_no)       COLLATE DATABASE_DEFAULT, '|',
        status_id,                                                   '|',
        is_active,                                                   '|',
        CONVERT(nvarchar(200), cifNo)       COLLATE DATABASE_DEFAULT, '|',
        CONVERT(nvarchar(200), FirstName)   COLLATE DATABASE_DEFAULT, '|',
        CONVERT(nvarchar(200), MiddleName)  COLLATE DATABASE_DEFAULT, '|',
        CONVERT(nvarchar(200), LastName)    COLLATE DATABASE_DEFAULT, '|',
        CONVERT(nvarchar(200), Suffix)      COLLATE DATABASE_DEFAULT, '|',
        CONVERT(varchar(30), BirthDate, 126),                        '|',
        LoanID,                                                      '|',
        LoanClass,                                                   '|',
        CONVERT(nvarchar(200), CompanyName) COLLATE DATABASE_DEFAULT, '|',
        TotalLoanAmount,                                             '|',
        CONVERT(varchar(40), SWITCHOFFSET(ReleaseDate, '+08:00'), 126), '|',
        CONVERT(nvarchar(200), ProductCode) COLLATE DATABASE_DEFAULT, '|',
        BranchID,                                                    '|',
        ReplacedById
    ) AS HashInput
) HI
ORDER BY Vector;
