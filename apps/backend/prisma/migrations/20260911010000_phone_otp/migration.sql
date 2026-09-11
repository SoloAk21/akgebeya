BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
DO $$
BEGIN
  IF current_schema() IS DISTINCT FROM 'akgebeya' THEN
    RAISE EXCEPTION 'Migration requires the akgebeya schema';
  END IF;
END $$;
CREATE TABLE "akgebeya"."phone_otps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "phone" VARCHAR(16) NOT NULL,
  "otpHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "resendAvailableAt" TIMESTAMPTZ(6) NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMPTZ(6),
  "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "phone_otps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "phone_otps_phone_check" CHECK ("phone" ~ '^\+251[79][0-9]{8}$'),
  CONSTRAINT "phone_otps_hash_check" CHECK ("otpHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "phone_otps_attempt_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "phone_otps_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "phone_otps_resend_check" CHECK ("resendAvailableAt" >= "createdAt" AND "resendAvailableAt" <= "expiresAt"),
  CONSTRAINT "phone_otps_consumed_check" CHECK ("consumedAt" IS NULL OR "consumedAt" >= "createdAt"),
  CONSTRAINT "phone_otps_revoked_check" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
);
-- One current challenge per phone, including during concurrent first requests.
CREATE UNIQUE INDEX "phone_otps_phone_key" ON "akgebeya"."phone_otps"("phone");
CREATE INDEX "phone_otps_expiresAt_idx" ON "akgebeya"."phone_otps"("expiresAt");
CREATE INDEX "phone_otps_consumedAt_revokedAt_expiresAt_idx"
  ON "akgebeya"."phone_otps"("consumedAt", "revokedAt", "expiresAt");
COMMIT;
