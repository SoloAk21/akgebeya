BEGIN;

ALTER TABLE akgebeya_foundation.listing_draft
  DROP CONSTRAINT listing_draft_status_check,
  ALTER COLUMN status TYPE varchar(8),
  ADD COLUMN "creationPayload" jsonb,
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN "priceEtb" numeric(14,2),
  ADD COLUMN "areaSqm" numeric(11,2),
  ADD COLUMN bedrooms integer,
  ADD COLUMN bathrooms integer,
  ADD COLUMN version integer NOT NULL DEFAULT 1;

-- Preserve the original create request before any editable fields can change.
UPDATE akgebeya_foundation.listing_draft SET "creationPayload" = jsonb_build_object(
  'title', title, 'transactionType', "transactionType", 'propertyType', "propertyType");
ALTER TABLE akgebeya_foundation.listing_draft
  ALTER COLUMN "creationPayload" SET NOT NULL,
  ADD CONSTRAINT listing_draft_creation_payload_check CHECK (jsonb_typeof("creationPayload") = 'object'),
  ADD CONSTRAINT listing_draft_status_check CHECK (status IN ('DRAFT', 'COMPLETE')),
  ADD CONSTRAINT listing_draft_version_check CHECK (version >= 1),
  ADD CONSTRAINT listing_draft_description_check CHECK (char_length(description) <= 2000),
  ADD CONSTRAINT listing_draft_price_check CHECK ("priceEtb" IS NULL OR "priceEtb" BETWEEN 0.01 AND 999999999999.99),
  ADD CONSTRAINT listing_draft_area_size_check CHECK ("areaSqm" IS NULL OR "areaSqm" BETWEEN 0.01 AND 999999999.99),
  ADD CONSTRAINT listing_draft_bedrooms_check CHECK (bedrooms IS NULL OR bedrooms BETWEEN 0 AND 100),
  ADD CONSTRAINT listing_draft_bathrooms_check CHECK (bathrooms IS NULL OR bathrooms BETWEEN 0 AND 100),
  ADD CONSTRAINT listing_draft_rooms_type_check CHECK (
    ("propertyType" NOT IN ('LAND', 'COMMERCIAL') OR bedrooms IS NULL)
    AND ("propertyType" <> 'LAND' OR bathrooms IS NULL)),
  ADD CONSTRAINT listing_draft_complete_check CHECK (status <> 'COMPLETE' OR (
    char_length(btrim(description)) >= 20 AND "priceEtb" IS NOT NULL AND "areaSqm" IS NOT NULL
    AND ("propertyType" NOT IN ('APARTMENT', 'HOUSE') OR (bedrooms IS NOT NULL AND bathrooms IS NOT NULL AND bathrooms >= 1))));

COMMIT;
