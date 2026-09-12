BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $$ BEGIN
  IF current_schema() IS DISTINCT FROM 'akgebeya' THEN
    RAISE EXCEPTION 'Migration requires the akgebeya schema';
  END IF;
END $$;
ALTER TYPE "akgebeya"."ListingStatus" ADD VALUE 'COMPLETE';
ALTER TYPE "akgebeya"."ListingStatus" ADD VALUE 'VALIDATE';
ALTER TABLE "akgebeya"."listings"
  DROP CONSTRAINT "listings_draft_publication_check",
  ADD CONSTRAINT "listings_draft_publication_check" CHECK (
    status::text NOT IN ('DRAFT', 'COMPLETE', 'VALIDATE') OR "publishedAt" IS NULL
  );
COMMIT;
