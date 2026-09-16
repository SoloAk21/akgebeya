BEGIN;
CREATE TABLE akgebeya_foundation.listing_ai_content (
  "listingId" uuid PRIMARY KEY REFERENCES akgebeya_foundation.listing_draft(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "requestId" uuid NOT NULL,
  "sourceVersion" integer NOT NULL CHECK ("sourceVersion" >= 1),
  copy jsonb NOT NULL,
  model varchar(100) NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
  "generatedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT listing_ai_content_copy_check CHECK (
    jsonb_typeof(copy) = 'object' AND copy ?& ARRAY['en', 'am']
    AND jsonb_typeof(copy->'en') = 'object' AND (copy->'en') ?& ARRAY['title', 'description']
    AND jsonb_typeof(copy->'am') = 'object' AND (copy->'am') ?& ARRAY['title', 'description']
    AND jsonb_typeof(copy->'en'->'title') = 'string' AND jsonb_typeof(copy->'am'->'title') = 'string'
    AND jsonb_typeof(copy->'en'->'description') = 'string' AND jsonb_typeof(copy->'am'->'description') = 'string'
    AND char_length(copy->'en'->>'title') BETWEEN 1 AND 120 AND char_length(copy->'am'->>'title') BETWEEN 1 AND 120
    AND char_length(copy->'en'->>'description') BETWEEN 20 AND 2000 AND char_length(copy->'am'->>'description') BETWEEN 20 AND 2000
  )
);
COMMIT;
