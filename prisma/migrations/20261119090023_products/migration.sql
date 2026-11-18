-- D-049: myloans products (API 5) with the optional manual classification.

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sourceProductId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "classification" "Classification",
    "classificationNote" TEXT NOT NULL DEFAULT '',
    "classifiedById" TEXT,
    "classifiedByLabel" TEXT NOT NULL DEFAULT '',
    "classifiedAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_sourceProductId_key" ON "Product"("sourceProductId");

-- CreateIndex
CREATE INDEX "Product_code_idx" ON "Product"("code");



-- D-049: "Manage product classification" (settings:classification) is on by default for the LA Supervisor/Head too
-- (Admin and Superadmin already have it).
UPDATE "Role" SET "permissions" = array_append("permissions", 'settings:classification')
WHERE "key" = 'SUP' AND NOT ('settings:classification' = ANY("permissions"));

-- D-049: the Financing keywords "brand new" and "2nd hand", added to saved rules that do not have them yet
-- (a database with no saved rules uses the defaults in lib/rules/classify.ts, which have them).
UPDATE "Setting"
SET "value" = jsonb_set("value"::jsonb, '{financing}', COALESCE("value"::jsonb -> 'financing', '[]'::jsonb) || '[{"text":"brand new","wholeWord":false}]'::jsonb)
WHERE "key" = 'classification.rules'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE("value"::jsonb -> 'financing', '[]'::jsonb)) e WHERE lower(COALESCE(e ->> 'text', e #>> '{}')) = 'brand new');
UPDATE "Setting"
SET "value" = jsonb_set("value"::jsonb, '{financing}', COALESCE("value"::jsonb -> 'financing', '[]'::jsonb) || '[{"text":"2nd hand","wholeWord":false}]'::jsonb)
WHERE "key" = 'classification.rules'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE("value"::jsonb -> 'financing', '[]'::jsonb)) e WHERE lower(COALESCE(e ->> 'text', e #>> '{}')) = '2nd hand');
