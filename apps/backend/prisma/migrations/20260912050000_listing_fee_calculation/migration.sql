BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $$ BEGIN
 IF current_schema() IS DISTINCT FROM 'akgebeya' THEN RAISE EXCEPTION 'Migration requires the akgebeya schema'; END IF;
END $$;
ALTER TYPE "akgebeya"."ListingStatus" ADD VALUE 'CALCULATE_FEE';
ALTER TABLE "akgebeya"."listings"
 DROP CONSTRAINT "listings_draft_publication_check",
 ADD CONSTRAINT "listings_draft_publication_check" CHECK (
  status::text NOT IN ('DRAFT','COMPLETE','VALIDATE','AI_ASSIST','PREVIEW','CALCULATE_FEE') OR "publishedAt" IS NULL
 ),
 DROP CONSTRAINT "listings_ai_assist_content_check",
 ADD CONSTRAINT "listings_ai_assist_content_check" CHECK (
  status::text NOT IN ('AI_ASSIST','PREVIEW','CALCULATE_FEE') OR ("titleAm" IS NOT NULL AND "descriptionAm" IS NOT NULL)
 );
CREATE TABLE "akgebeya"."listing_fee_quotes" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(),
 "listingId" UUID NOT NULL,
 "amountMinor" BIGINT NOT NULL,
 "currency" "akgebeya"."Currency" NOT NULL,
 "pricingVersion" VARCHAR(64) NOT NULL,
 "sourceRevision" VARCHAR(66) NOT NULL,
 "calculatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "listing_fee_quotes_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "listing_fee_quotes_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "akgebeya"."listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "listing_fee_quotes_v1_check" CHECK ("amountMinor" > 0 AND "amountMinor" = 50000 AND currency = 'ETB' AND "pricingVersion" = 'v1'),
 CONSTRAINT "listing_fee_quotes_revision_check" CHECK ("sourceRevision" ~ '^"[a-f0-9]{64}"$'),
 CONSTRAINT "listing_fee_quotes_time_check" CHECK ("calculatedAt" >= "createdAt" AND isfinite("createdAt") AND isfinite("calculatedAt"))
);
CREATE UNIQUE INDEX "listing_fee_quotes_listingId_key" ON "akgebeya"."listing_fee_quotes"("listingId");
CREATE FUNCTION "akgebeya"."reject_fee_quote_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Fee quotes are immutable';
END $$;
CREATE TRIGGER "listing_fee_quotes_immutable" BEFORE UPDATE ON "akgebeya"."listing_fee_quotes"
 FOR EACH ROW EXECUTE FUNCTION "akgebeya"."reject_fee_quote_update"();
CREATE FUNCTION "akgebeya"."check_listing_fee_quote"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id UUID; current_status TEXT; has_quote BOOLEAN;
BEGIN
 IF TG_TABLE_NAME = 'listings' THEN target_id := NEW.id;
 ELSIF TG_OP = 'DELETE' THEN target_id := OLD."listingId";
 ELSE target_id := NEW."listingId"; END IF;
 SELECT status::text INTO current_status FROM "akgebeya"."listings" WHERE id = target_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT EXISTS (SELECT 1 FROM "akgebeya"."listing_fee_quotes" WHERE "listingId" = target_id) INTO has_quote;
 IF (current_status = 'CALCULATE_FEE') IS DISTINCT FROM has_quote THEN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Fee quote and listing state must agree';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "listings_fee_quote_required" AFTER INSERT OR UPDATE ON "akgebeya"."listings"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "akgebeya"."check_listing_fee_quote"();
CREATE CONSTRAINT TRIGGER "listing_fee_quote_state" AFTER INSERT OR DELETE ON "akgebeya"."listing_fee_quotes"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "akgebeya"."check_listing_fee_quote"();
COMMIT;
