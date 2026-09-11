BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $$
BEGIN
  IF current_schema() IS DISTINCT FROM 'akgebeya' THEN
    RAISE EXCEPTION 'Migration requires the akgebeya schema';
  END IF;
END $$;
ALTER TABLE "akgebeya"."users" ADD COLUMN "googleSub" VARCHAR(255);
ALTER TABLE "akgebeya"."users" ADD CONSTRAINT "users_google_sub_check"
  CHECK ("googleSub" IS NULL OR "googleSub" ~ '[^[:space:]]');
CREATE UNIQUE INDEX "users_googleSub_key" ON "akgebeya"."users"("googleSub");
COMMIT;
