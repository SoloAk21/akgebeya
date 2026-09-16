BEGIN;
CREATE TABLE akgebeya_foundation.listing_draft (
  id uuid PRIMARY KEY,
  "accountId" uuid NOT NULL REFERENCES akgebeya_foundation.account(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "requestId" uuid NOT NULL,
  title varchar(120) NOT NULL,
  "transactionType" varchar(4) NOT NULL,
  "propertyType" varchar(10) NOT NULL,
  status varchar(5) NOT NULL DEFAULT 'DRAFT',
  "countryId" varchar(2) NOT NULL,
  "regionId" varchar(40) NOT NULL,
  "cityId" varchar(40) NOT NULL,
  "subcityId" varchar(40) NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  address jsonb,
  "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT listing_draft_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT listing_draft_transaction_check CHECK ("transactionType" IN ('RENT', 'SALE')),
  CONSTRAINT listing_draft_property_check CHECK ("propertyType" IN ('APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL')),
  CONSTRAINT listing_draft_status_check CHECK (status = 'DRAFT'),
  CONSTRAINT listing_draft_area_check CHECK (
    "countryId" = 'ET' AND "regionId" = 'addis-ababa' AND "cityId" = 'addis-ababa-city'
    AND "subcityId" IN ('addis-ketema', 'akaki-kality', 'arada', 'bole', 'gulele', 'kirkos',
      'kolfe-keranio', 'lideta', 'nifas-silk-lafto', 'yeka', 'lemi-kura')
    AND latitude BETWEEN 8.8 AND 9.15 AND longitude BETWEEN 38.6 AND 39.0),
  CONSTRAINT listing_draft_address_check CHECK (address IS NULL OR jsonb_typeof(address) = 'object')
);
CREATE UNIQUE INDEX "listing_draft_accountId_requestId_key" ON akgebeya_foundation.listing_draft ("accountId", "requestId");
CREATE INDEX "listing_draft_accountId_createdAt_id_idx" ON akgebeya_foundation.listing_draft ("accountId", "createdAt", id);
COMMIT;
