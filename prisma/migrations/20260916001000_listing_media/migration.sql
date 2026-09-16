BEGIN;
ALTER TABLE akgebeya_foundation.listing_draft
  ADD COLUMN "mediaVersion" integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT listing_draft_media_version_check CHECK ("mediaVersion" >= 1);

CREATE TABLE akgebeya_foundation.listing_media (
  id uuid PRIMARY KEY,
  "listingId" uuid NOT NULL REFERENCES akgebeya_foundation.listing_draft(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "requestId" uuid NOT NULL,
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 9),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 1600),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 1600),
  "byteSize" integer NOT NULL CHECK ("byteSize" BETWEEN 1 AND 1048576),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 1048576),
  "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT listing_media_bytes_length_check CHECK ("byteSize" = octet_length(bytes)),
  CONSTRAINT "listing_media_listingId_requestId_key" UNIQUE ("listingId", "requestId"),
  CONSTRAINT "listing_media_listingId_position_key" UNIQUE ("listingId", position) DEFERRABLE INITIALLY DEFERRED
);
COMMIT;
