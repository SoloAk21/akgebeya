BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $$ BEGIN
 IF current_schema() IS DISTINCT FROM 'akgebeya' THEN RAISE EXCEPTION 'Migration requires the akgebeya schema'; END IF;
END $$;
ALTER TYPE "akgebeya"."ListingStatus" ADD VALUE 'PREVIEW';
ALTER TABLE "akgebeya"."listings"
 DROP CONSTRAINT "listings_draft_publication_check",
 ADD CONSTRAINT "listings_draft_publication_check" CHECK (
  status::text NOT IN ('DRAFT','COMPLETE','VALIDATE','AI_ASSIST','PREVIEW') OR "publishedAt" IS NULL
 ),
 DROP CONSTRAINT "listings_ai_assist_content_check",
 ADD CONSTRAINT "listings_ai_assist_content_check" CHECK (
  status::text NOT IN ('AI_ASSIST','PREVIEW') OR ("titleAm" IS NOT NULL AND "descriptionAm" IS NOT NULL)
 );
COMMIT;
