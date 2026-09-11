BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $$
BEGIN
  IF current_schema() IS DISTINCT FROM 'akgebeya' THEN
    RAISE EXCEPTION 'Migration requires the akgebeya schema';
  END IF;
END $$;
ALTER TABLE "akgebeya"."users" ADD COLUMN "telegramId" BIGINT;
CREATE UNIQUE INDEX "users_telegramId_key" ON "akgebeya"."users"("telegramId");
ALTER TABLE "akgebeya"."users"
  DROP CONSTRAINT "users_identity_check",
  ADD CONSTRAINT "users_identity_check"
    CHECK (num_nonnulls("email", "phone", "telegramId") >= 1);
COMMIT;
