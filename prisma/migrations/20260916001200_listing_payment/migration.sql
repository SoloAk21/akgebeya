BEGIN;
CREATE TABLE akgebeya_foundation.listing_payment (
  id uuid PRIMARY KEY,
  "listingId" uuid NOT NULL REFERENCES akgebeya_foundation.listing_draft(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "requestId" uuid NOT NULL,
  reference varchar(40) NOT NULL CHECK (reference = 'akg-' || id::text),
  "sourceVersion" integer NOT NULL CHECK ("sourceVersion" >= 1),
  "mediaVersion" integer NOT NULL CHECK ("mediaVersion" >= 1),
  amount numeric(14,2) NOT NULL CHECK (amount > 0 AND amount <= 999999999999.99),
  currency varchar(3) NOT NULL CHECK (currency = 'ETB'),
  "policyRevision" varchar(100) NOT NULL CHECK (char_length("policyRevision") BETWEEN 1 AND 100),
  status varchar(12) NOT NULL DEFAULT 'INITIALIZING' CHECK (status IN ('INITIALIZING', 'READY', 'UNKNOWN', 'FAILED')),
  "checkoutUrl" varchar(2048),
  "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT listing_payment_checkout_state_check CHECK (
    (status = 'READY' AND "checkoutUrl" IS NOT NULL AND char_length("checkoutUrl") > 0)
    OR (status <> 'READY' AND "checkoutUrl" IS NULL)),
  CONSTRAINT "listing_payment_listingId_key" UNIQUE ("listingId"),
  CONSTRAINT "listing_payment_reference_key" UNIQUE (reference)
);
COMMIT;
