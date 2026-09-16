BEGIN;
ALTER TABLE "akgebeya_foundation"."account" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "akgebeya_foundation"."provider_review" (
  "accountId" UUID PRIMARY KEY REFERENCES "akgebeya_foundation"."provider_application"("accountId") ON DELETE CASCADE ON UPDATE CASCADE,
  "reviewerId" UUID NOT NULL REFERENCES "akgebeya_foundation"."account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "decision" "akgebeya_foundation"."ProviderVerificationStatus" NOT NULL,
  "reason" VARCHAR(500),
  "reviewedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_review_decision_valid" CHECK ("decision" IN ('APPROVED', 'REJECTED')),
  CONSTRAINT "provider_review_reason_valid" CHECK (
    ("reason" IS NULL OR (char_length(btrim("reason")) > 0 AND "reason" = btrim("reason")))
    AND ("decision" <> 'REJECTED' OR "reason" IS NOT NULL)
  ),
  CONSTRAINT "provider_review_no_self_review" CHECK ("accountId" <> "reviewerId")
);
CREATE INDEX "provider_review_reviewerId_idx" ON "akgebeya_foundation"."provider_review"("reviewerId");
COMMIT;
