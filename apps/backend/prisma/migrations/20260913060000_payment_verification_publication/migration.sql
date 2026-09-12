BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $$ BEGIN
 IF current_schema() IS DISTINCT FROM 'akgebeya' THEN RAISE EXCEPTION 'Migration requires akgebeya'; END IF;
 IF EXISTS(SELECT 1 FROM akgebeya.listings WHERE status::text='PUBLISHED') THEN
  RAISE EXCEPTION 'Existing published listings require payment history review';
 END IF;
END $$;
ALTER TYPE akgebeya."ListingStatus" ADD VALUE 'VERIFY_PAYMENT';
ALTER TABLE akgebeya.listings
 DROP CONSTRAINT listings_draft_publication_check,
 ADD CONSTRAINT listings_draft_publication_check CHECK(status::text NOT IN ('DRAFT','COMPLETE','VALIDATE','AI_ASSIST','PREVIEW','CALCULATE_FEE','PAYMENT','VERIFY_PAYMENT') OR "publishedAt" IS NULL),
 DROP CONSTRAINT listings_ai_assist_content_check,
 ADD CONSTRAINT listings_ai_assist_content_check CHECK(status::text NOT IN ('AI_ASSIST','PREVIEW','CALCULATE_FEE','PAYMENT','VERIFY_PAYMENT','PUBLISHED') OR ("titleAm" IS NOT NULL AND "descriptionAm" IS NOT NULL));
ALTER TABLE akgebeya.payments DROP CONSTRAINT payments_initialization_check,
 ADD CONSTRAINT payments_initialization_check CHECK (
  ("feeQuoteId" IS NULL AND "initializationStatus" IS NULL AND "sourceRevision" IS NULL AND "checkoutUrl" IS NULL)
  OR ("feeQuoteId" IS NOT NULL AND "listingId" IS NOT NULL AND "initializationStatus" IS NOT NULL
   AND "sourceRevision" IS NOT NULL AND "sourceRevision" ~ '^"[a-f0-9]{64}"$'
   AND "gatewayReference" IS NOT NULL AND gateway='CHAPA' AND "amountMinor"=50000 AND currency='ETB'
   AND "refundedAmountMinor"=0 AND status::text IN ('PENDING','FAILED','SUCCEEDED')
   AND ((status='SUCCEEDED' AND "paidAt" IS NOT NULL AND isfinite("paidAt") AND "paidAt">="createdAt")
     OR(status<>'SUCCEEDED' AND "paidAt" IS NULL))
   AND ("initializationStatus"<>'REJECTED' OR status IN ('FAILED','SUCCEEDED'))
   AND (("initializationStatus"='INITIALIZED' AND "checkoutUrl" IS NOT NULL AND length(btrim("checkoutUrl"))>0)
     OR ("initializationStatus"<>'INITIALIZED' AND "checkoutUrl" IS NULL)))
 );
CREATE OR REPLACE FUNCTION akgebeya.guard_payment_initialization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD."feeQuoteId" IS NOT NULL THEN
  IF ROW(NEW."feeQuoteId",NEW."listingId",NEW."userId",NEW."amountMinor",NEW.currency,NEW.gateway,NEW."gatewayReference",NEW."idempotencyKey",NEW."sourceRevision")
   IS DISTINCT FROM ROW(OLD."feeQuoteId",OLD."listingId",OLD."userId",OLD."amountMinor",OLD.currency,OLD.gateway,OLD."gatewayReference",OLD."idempotencyKey",OLD."sourceRevision") THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Payment reservation binding is immutable';
  END IF;
  IF (OLD."initializationStatus"<>'RESERVED' OR OLD.status<>'PENDING')
   AND ROW(NEW."initializationStatus",NEW."checkoutUrl") IS DISTINCT FROM ROW(OLD."initializationStatus",OLD."checkoutUrl") THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Initialization history is immutable';
  END IF;
  IF OLD.status='SUCCEEDED' AND ROW(NEW.status,NEW."paidAt") IS DISTINCT FROM ROW(OLD.status,OLD."paidAt") THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Verified success is immutable';
  END IF;
  IF OLD.status='FAILED' AND NEW.status NOT IN ('FAILED','SUCCEEDED') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Failed payment cannot return to pending';
  END IF;
 END IF;
 IF NEW."feeQuoteId" IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM akgebeya.listing_fee_quotes q JOIN akgebeya.listings l ON l.id=q."listingId" JOIN akgebeya.providers p ON p.id=l."providerId"
  WHERE q.id=NEW."feeQuoteId" AND q."listingId"=NEW."listingId" AND p."userId"=NEW."userId"
   AND q."amountMinor"=NEW."amountMinor" AND q.currency=NEW.currency AND q."pricingVersion"='v1') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Payment quote binding invalid';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION akgebeya.check_listing_fee_quote() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id UUID; current_status TEXT; has_quote BOOLEAN;
BEGIN
 IF TG_TABLE_NAME='listings' THEN target_id:=NEW.id;
 ELSIF TG_OP='DELETE' THEN target_id:=OLD."listingId"; ELSE target_id:=NEW."listingId"; END IF;
 SELECT status::text INTO current_status FROM akgebeya.listings WHERE id=target_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT EXISTS(SELECT 1 FROM akgebeya.listing_fee_quotes WHERE "listingId"=target_id) INTO has_quote;
 IF (current_status IN ('CALCULATE_FEE','PAYMENT','VERIFY_PAYMENT','PUBLISHED')) IS DISTINCT FROM has_quote THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Fee quote and listing state must agree';
 END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION akgebeya.check_listing_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id UUID; listing_status TEXT; initialized BOOLEAN; succeeded BOOLEAN;
BEGIN
 IF TG_TABLE_NAME='listings' THEN target_id:=NEW.id;
 ELSIF TG_OP='DELETE' THEN target_id:=OLD."listingId"; ELSE target_id:=NEW."listingId"; END IF;
 IF target_id IS NULL THEN RETURN NULL; END IF;
 SELECT status::text INTO listing_status FROM akgebeya.listings WHERE id=target_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT EXISTS(SELECT 1 FROM akgebeya.payments p JOIN akgebeya.listing_fee_quotes q ON q.id=p."feeQuoteId"
  WHERE p."listingId"=target_id AND q."listingId"=target_id AND p."initializationStatus"='INITIALIZED' AND p.status IN ('PENDING','FAILED')) INTO initialized;
 SELECT EXISTS(SELECT 1 FROM akgebeya.payments p JOIN akgebeya.listing_fee_quotes q ON q.id=p."feeQuoteId"
  WHERE p."listingId"=target_id AND q."listingId"=target_id AND p.status='SUCCEEDED' AND p."paidAt" IS NOT NULL
  AND p."amountMinor"=q."amountMinor" AND p.currency=q.currency AND q."pricingVersion"='v1') INTO succeeded;
 IF (listing_status='PAYMENT') IS DISTINCT FROM initialized
  OR (listing_status IN ('VERIFY_PAYMENT','PUBLISHED')) IS DISTINCT FROM succeeded THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Listing and authoritative payment state must agree';
 END IF;
 IF EXISTS(SELECT 1 FROM akgebeya.payments pay JOIN akgebeya.listing_fee_quotes q ON q.id=pay."feeQuoteId"
  JOIN akgebeya.listings l ON l.id=q."listingId" JOIN akgebeya.providers pr ON pr.id=l."providerId"
  WHERE pay."listingId"=target_id AND (pay."listingId"<>q."listingId" OR pay."userId"<>pr."userId")) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Payment ownership binding invalid';
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION akgebeya.guard_paid_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status::text='PUBLISHED' THEN
  IF TG_OP='INSERT' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Publication requires verified payment transition'; END IF;
  IF OLD.status::text NOT IN ('VERIFY_PAYMENT','PUBLISHED') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Publication requires verified payment transition';
  END IF;
  IF OLD.status::text='PUBLISHED' AND NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt" THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Publication timestamp is immutable';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER listings_paid_publication_guard BEFORE INSERT OR UPDATE ON akgebeya.listings FOR EACH ROW EXECUTE FUNCTION akgebeya.guard_paid_publication();
COMMIT;
