BEGIN;
CREATE TYPE "akgebeya_foundation"."ProviderType" AS ENUM ('OWNER', 'BROKER', 'AGENT', 'AGENCY', 'DEVELOPER');
CREATE TYPE "akgebeya_foundation"."ProviderVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TABLE "akgebeya_foundation"."provider_application" (
  "accountId" UUID NOT NULL,
  "providerType" "akgebeya_foundation"."ProviderType" NOT NULL,
  "status" "akgebeya_foundation"."ProviderVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_application_pkey" PRIMARY KEY ("accountId"),
  CONSTRAINT "provider_application_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "akgebeya_foundation"."account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
COMMIT;
