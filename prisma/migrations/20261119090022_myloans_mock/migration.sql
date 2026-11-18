-- Piece 6 (D-047, D-048): the myloans mock's own data (local and staging only; never read in production).

-- CreateTable
CREATE TABLE "MockMyLoansTxn" (
    "id" INTEGER NOT NULL,
    "cin" TEXT,
    "pnNo" TEXT,
    "statusId" INTEGER NOT NULL DEFAULT 12,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "code" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "replacedById" INTEGER,
    "duplicate" BOOLEAN NOT NULL DEFAULT false,
    "releaseDate" TIMESTAMP(3),
    "amount" TEXT,
    "cifNo" TEXT,
    "firstName" TEXT,
    "middleName" TEXT,
    "lastName" TEXT,
    "suffix" TEXT,
    "loanId" TEXT,
    "loanTypeId" TEXT,
    "loanType" TEXT,
    "borrowerCompanyName" TEXT,
    "productId" INTEGER,
    "branchId" INTEGER,
    "source" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "MockMyLoansTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockMyLoansProduct" (
    "productId" INTEGER NOT NULL,
    "productCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MockMyLoansProduct_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "MockMyLoansBranch" (
    "branchId" INTEGER NOT NULL,
    "branchCode" TEXT,
    "branchName" TEXT NOT NULL,
    "areaId" INTEGER,
    "areaName" TEXT,
    "divisionId" INTEGER,
    "divisionName" TEXT,
    "companyId" INTEGER,
    "companyName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "MockMyLoansBranch_pkey" PRIMARY KEY ("branchId")
);

-- CreateIndex
CREATE INDEX "MockMyLoansTxn_pnNo_idx" ON "MockMyLoansTxn"("pnNo");

-- CreateIndex
CREATE INDEX "MockMyLoansTxn_cin_idx" ON "MockMyLoansTxn"("cin");

