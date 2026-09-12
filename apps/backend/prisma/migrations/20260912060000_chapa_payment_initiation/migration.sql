BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $$ BEGIN
 IF current_schema() IS DISTINCT FROM 'akgebeya' THEN RAISE EXCEPTION 'Migration requires the akgebeya schema'; END IF;
END $$;
ALTER TYPE "akgebeya"."ListingStatus" ADD VALUE 'PAYMENT';
ALTER TABLE "akgebeya"."listings"
 DROP CONSTRAINT "listings_draft_publication_check",
 ADD CONSTRAINT "listings_draft_publication_check" CHECK (
  status::text NOT IN ('DRAFT','COMPLETE','VALIDATE','AI_ASSIST','PREVIEW','CALCULATE_FEE','PAYMENT') OR "publishedAt" IS NULL
 ),
 DROP CONSTRAINT "listings_ai_assist_content_check",
 ADD CONSTRAINT "listings_ai_assist_content_check" CHECK (
  status::text NOT IN ('AI_ASSIST','PREVIEW','CALCULATE_FEE','PAYMENT') OR ("titleAm" IS NOT NULL AND "descriptionAm" IS NOT NULL)
 );
CREATE TYPE "akgebeya"."PaymentInitializationStatus" AS ENUM ('RESERVED','INITIALIZED','REJECTED','UNKNOWN');
ALTER TABLE "akgebeya"."payments"
 ADD COLUMN "feeQuoteId" UUID,
 ADD COLUMN "initializationStatus" "akgebeya"."PaymentInitializationStatus",
 ADD COLUMN "sourceRevision" VARCHAR(66),
 ADD COLUMN "checkoutUrl" VARCHAR(2048),
 ADD CONSTRAINT "payments_feeQuoteId_fkey" FOREIGN KEY ("feeQuoteId") REFERENCES "akgebeya"."listing_fee_quotes"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "payments_initialization_check" CHECK (
  ("feeQuoteId" IS NULL AND "initializationStatus" IS NULL AND "sourceRevision" IS NULL AND "checkoutUrl" IS NULL)
  OR ("feeQuoteId" IS NOT NULL AND "listingId" IS NOT NULL AND "initializationStatus" IS NOT NULL
   AND "sourceRevision" IS NOT NULL AND "sourceRevision" ~ '^"[a-f0-9]{64}"$'
   AND "gatewayReference" IS NOT NULL AND gateway='CHAPA' AND "amountMinor"=50000 AND currency='ETB'
   AND "paidAt" IS NULL AND "refundedAmountMinor"=0
   AND (("initializationStatus"='REJECTED' AND status='FAILED') OR ("initializationStatus"<>'REJECTED' AND status='PENDING'))
   AND (("initializationStatus"='INITIALIZED' AND "checkoutUrl" IS NOT NULL AND length(btrim("checkoutUrl"))>0)
     OR ("initializationStatus"<>'INITIALIZED' AND "checkoutUrl" IS NULL)))
 );
CREATE UNIQUE INDEX "payments_feeQuoteId_key" ON "akgebeya"."payments"("feeQuoteId");
CREATE OR REPLACE FUNCTION "akgebeya"."check_listing_fee_quote"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id UUID; current_status TEXT; has_quote BOOLEAN;
BEGIN
 IF TG_TABLE_NAME = 'listings' THEN target_id := NEW.id;
 ELSIF TG_OP = 'DELETE' THEN target_id := OLD."listingId";
 ELSE target_id := NEW."listingId"; END IF;
 SELECT status::text INTO current_status FROM "akgebeya"."listings" WHERE id = target_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT EXISTS (SELECT 1 FROM "akgebeya"."listing_fee_quotes" WHERE "listingId" = target_id) INTO has_quote;
 IF (current_status IN ('CALCULATE_FEE','PAYMENT')) IS DISTINCT FROM has_quote THEN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Fee quote and listing state must agree';
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION "akgebeya"."guard_payment_initialization"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD."feeQuoteId" IS NOT NULL THEN
  IF ROW(NEW."feeQuoteId",NEW."listingId",NEW."userId",NEW."amountMinor",NEW.currency,NEW.gateway,NEW."gatewayReference",NEW."idempotencyKey",NEW."sourceRevision")
   IS DISTINCT FROM ROW(OLD."feeQuoteId",OLD."listingId",OLD."userId",OLD."amountMinor",OLD.currency,OLD.gateway,OLD."gatewayReference",OLD."idempotencyKey",OLD."sourceRevision") THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Payment reservation binding is immutable';
  END IF;
  IF OLD."initializationStatus"<>'RESERVED' AND ROW(NEW."initializationStatus",NEW.status,NEW."checkoutUrl") IS DISTINCT FROM ROW(OLD."initializationStatus",OLD.status,OLD."checkoutUrl") THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Payment initialization outcome is final';
  END IF;
 END IF;
 IF NEW."feeQuoteId" IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM akgebeya.listing_fee_quotes q JOIN akgebeya.listings l ON l.id=q."listingId" JOIN akgebeya.providers p ON p.id=l."providerId"
   WHERE q.id=NEW."feeQuoteId" AND q."listingId"=NEW."listingId" AND p."userId"=NEW."userId"
    AND q."amountMinor"=NEW."amountMinor" AND q.currency=NEW.currency AND q."pricingVersion"='v1') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Payment quote binding invalid';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "payments_initialization_guard" BEFORE INSERT OR UPDATE ON akgebeya.payments FOR EACH ROW EXECUTE FUNCTION akgebeya.guard_payment_initialization();
CREATE FUNCTION "akgebeya"."check_listing_payment"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id UUID; listing_status TEXT; initialized BOOLEAN;
BEGIN
 IF TG_TABLE_NAME='listings' THEN target_id:=NEW.id;
 ELSIF TG_OP='DELETE' THEN target_id:=OLD."listingId";
 ELSE target_id:=NEW."listingId"; END IF;
 IF target_id IS NULL THEN RETURN NULL; END IF;
 SELECT status::text INTO listing_status FROM akgebeya.listings WHERE id=target_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT EXISTS(SELECT 1 FROM akgebeya.payments p JOIN akgebeya.listing_fee_quotes q ON q.id=p."feeQuoteId"
  WHERE p."listingId"=target_id AND q."listingId"=target_id AND p."initializationStatus"='INITIALIZED' AND p.status='PENDING') INTO initialized;
 IF (listing_status='PAYMENT') IS DISTINCT FROM initialized THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Listing payment state must agree with initialization';
 END IF;
 IF EXISTS(SELECT 1 FROM akgebeya.payments pay JOIN akgebeya.listing_fee_quotes q ON q.id=pay."feeQuoteId"
  JOIN akgebeya.listings l ON l.id=q."listingId" JOIN akgebeya.providers pr ON pr.id=l."providerId"
  WHERE pay."listingId"=target_id AND (pay."listingId"<>q."listingId" OR pay."userId"<>pr."userId")) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Payment ownership binding invalid';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "listings_payment_required" AFTER INSERT OR UPDATE ON akgebeya.listings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION akgebeya.check_listing_payment();
CREATE CONSTRAINT TRIGGER "payments_listing_state" AFTER INSERT OR UPDATE OR DELETE ON akgebeya.payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION akgebeya.check_listing_payment();
COMMIT;
