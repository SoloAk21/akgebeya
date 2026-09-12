BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $$ BEGIN
  IF current_schema() IS DISTINCT FROM 'akgebeya' THEN
    RAISE EXCEPTION 'Migration requires the akgebeya schema';
  END IF;
END $$;
LOCK TABLE "akgebeya"."listings" IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "akgebeya"."listings") THEN
    RAISE EXCEPTION 'LISTINGS_NOT_EMPTY: stop for classification review';
  END IF;
END $$;

CREATE TYPE "akgebeya"."PropertyCategory" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'LAND');
CREATE TYPE "akgebeya"."PropertyType_v46" AS ENUM ('STUDIO', 'APARTMENT', 'CONDOMINIUM', 'VILLA', 'HOUSE', 'G_PLUS_1', 'G_PLUS_2', 'OFFICE', 'SHOP', 'WAREHOUSE', 'BUILDING', 'HOTEL', 'INDUSTRIAL_LAND', 'AGRICULTURAL_LAND', 'RESIDENTIAL_LAND', 'COMMERCIAL_LAND');
ALTER TABLE "akgebeya"."listings"
  ALTER COLUMN "propertyType" TYPE "akgebeya"."PropertyType_v46"
  USING "propertyType"::text::"akgebeya"."PropertyType_v46";
DROP TYPE "akgebeya"."PropertyType";
ALTER TYPE "akgebeya"."PropertyType_v46" RENAME TO "PropertyType";
ALTER TYPE "akgebeya"."ListingType" ADD VALUE 'BUY_REQUEST';
ALTER TYPE "akgebeya"."ListingType" ADD VALUE 'RENT_REQUEST';

ALTER TABLE "akgebeya"."listings"
  ADD COLUMN "category" "akgebeya"."PropertyCategory",
  ALTER COLUMN "type" DROP NOT NULL,
  ALTER COLUMN "propertyType" DROP NOT NULL,
  ALTER COLUMN "titleEn" DROP NOT NULL,
  ALTER COLUMN "descriptionEn" DROP NOT NULL,
  ALTER COLUMN "locationId" DROP NOT NULL,
  ALTER COLUMN "price" DROP NOT NULL,
  DROP CONSTRAINT "listings_content_check",
  DROP CONSTRAINT "listings_price_check",
  DROP CONSTRAINT "listings_dimensions_check";

ALTER TABLE "akgebeya"."listings"
  ADD CONSTRAINT "listings_category_type_check" CHECK (
    "propertyType" IS NULL OR (category IS NOT NULL AND (
      (category = 'RESIDENTIAL' AND "propertyType" IN ('STUDIO','APARTMENT','CONDOMINIUM','VILLA','HOUSE','G_PLUS_1','G_PLUS_2'))
      OR (category = 'COMMERCIAL' AND "propertyType" IN ('OFFICE','SHOP','WAREHOUSE','BUILDING','HOTEL'))
      OR (category = 'LAND' AND "propertyType" IN ('INDUSTRIAL_LAND','AGRICULTURAL_LAND','RESIDENTIAL_LAND','COMMERCIAL_LAND'))
    ))
  ),
  ADD CONSTRAINT "listings_content_check" CHECK (
    ("titleEn" IS NULL OR "titleEn" ~ '[^[:space:]]') AND
    ("titleAm" IS NULL OR "titleAm" ~ '[^[:space:]]') AND
    ("descriptionEn" IS NULL OR "descriptionEn" ~ '[^[:space:]]') AND
    ("descriptionAm" IS NULL OR "descriptionAm" ~ '[^[:space:]]')
  ),
  ADD CONSTRAINT "listings_price_check" CHECK (
    price IS NULL OR (price > 0 AND price < 'Infinity'::numeric)
  ),
  ADD CONSTRAINT "listings_dimensions_check" CHECK (
    (bedrooms IS NULL OR bedrooms >= 0) AND (bathrooms IS NULL OR bathrooms >= 0) AND
    ("areaSqm" IS NULL OR ("areaSqm" > 0 AND "areaSqm" < 'Infinity'::numeric))
  ),
  ADD CONSTRAINT "listings_non_draft_complete_check" CHECK (
    status = 'DRAFT' OR (category IS NOT NULL AND type IS NOT NULL AND "propertyType" IS NOT NULL
      AND "titleEn" IS NOT NULL AND "descriptionEn" IS NOT NULL AND "locationId" IS NOT NULL AND price IS NOT NULL)
  ),
  ADD CONSTRAINT "listings_draft_publication_check" CHECK (status <> 'DRAFT' OR "publishedAt" IS NULL);
COMMIT;
