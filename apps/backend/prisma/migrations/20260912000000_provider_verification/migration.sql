-- Commit the enum value before using it in constraints (PostgreSQL requirement).
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $$ BEGIN
  IF current_schema() IS DISTINCT FROM 'akgebeya' THEN
    RAISE EXCEPTION 'Migration requires the akgebeya schema';
  END IF;
END $$;
ALTER TYPE "akgebeya"."VerificationType" ADD VALUE 'PROVIDER';
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
CREATE TYPE "akgebeya"."ProviderRole" AS ENUM ('OWNER', 'BROKER', 'AGENT', 'AGENCY', 'DEVELOPER');
ALTER TABLE "akgebeya"."providers" ADD COLUMN "role" "akgebeya"."ProviderRole";
ALTER TABLE "akgebeya"."verifications" DROP CONSTRAINT "verifications_target_check";
ALTER TABLE "akgebeya"."verifications" ADD CONSTRAINT "verifications_target_check" CHECK (
  ("type" IN ('IDENTITY', 'PROVIDER') AND "target" IS NULL AND "tokenHash" IS NULL)
  OR ("type" IN ('EMAIL', 'PHONE') AND "target" IS NOT NULL AND length(btrim("target")) > 0 AND "tokenHash" IS NOT NULL)
);
ALTER TABLE "akgebeya"."verifications" ADD CONSTRAINT "verifications_provider_review_check" CHECK (
  "type" <> 'PROVIDER' OR (
    ("reviewerId" IS NULL OR "reviewerId" <> "userId")
    AND (("status" IN ('PENDING', 'EXPIRED') AND "reviewedAt" IS NULL AND "reviewerId" IS NULL)
      OR ("status" IN ('APPROVED', 'REJECTED') AND "reviewedAt" IS NOT NULL AND "reviewedAt" >= "createdAt"))
  )
);
CREATE UNIQUE INDEX "verifications_provider_pending_key"
  ON "akgebeya"."verifications" ("userId") WHERE "type" = 'PROVIDER' AND "status" = 'PENDING';

-- Provider.userId is unique: reuse that identity instead of adding a parallel relation.
CREATE FUNCTION "akgebeya"."check_provider_verification_owner"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."type" = 'PROVIDER' THEN
    PERFORM 1 FROM "akgebeya"."providers" WHERE "userId" = NEW."userId" FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Provider profile required' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "verifications_provider_owner"
  BEFORE INSERT OR UPDATE OF "userId", "type" ON "akgebeya"."verifications"
  FOR EACH ROW EXECUTE FUNCTION "akgebeya"."check_provider_verification_owner"();

CREATE FUNCTION "akgebeya"."preserve_provider_verification_owner"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "akgebeya"."verifications" WHERE "userId" = OLD."userId" AND "type" = 'PROVIDER') THEN
    RAISE EXCEPTION 'Provider verification history must be preserved' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "providers_preserve_verification_owner"
  BEFORE DELETE OR UPDATE OF "userId" ON "akgebeya"."providers"
  FOR EACH ROW EXECUTE FUNCTION "akgebeya"."preserve_provider_verification_owner"();
COMMIT;
