BEGIN;
ALTER TABLE "akgebeya_foundation"."account"
ADD COLUMN "displayName" VARCHAR(80),
ADD CONSTRAINT "account_display_name_valid" CHECK (
  "displayName" IS NULL OR
  (char_length("displayName") BETWEEN 1 AND 80 AND "displayName" = btrim("displayName"))
);
COMMIT;
