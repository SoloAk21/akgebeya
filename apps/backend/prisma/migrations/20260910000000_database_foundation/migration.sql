-- Apply atomically. A failure rolls back this foundation instead of leaving partial tables.
BEGIN;
DO $$ BEGIN
  IF current_schema() <> 'akgebeya' THEN
    RAISE EXCEPTION 'This foundation must be applied to schema akgebeya';
  END IF;
END $$;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
-- PostGIS lives in public; application objects live in the configured Prisma schema.
SELECT set_config('search_path', quote_ident(current_schema()) || ', public', true);

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('SALE', 'RENT');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('ETB');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('CHAPA');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "VerificationType" AS ENUM ('EMAIL', 'PHONE', 'IDENTITY');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "MediaVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'REWARDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SYSTEM', 'LISTING', 'PAYMENT', 'VERIFICATION', 'REFERRAL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(320),
    "phone" VARCHAR(16),
    "displayName" VARCHAR(120) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "preferredLocale" VARCHAR(2) NOT NULL DEFAULT 'en',
    "referralCode" VARCHAR(32),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "nameEn" VARCHAR(160) NOT NULL,
    "nameAm" VARCHAR(160),
    "descriptionEn" TEXT,
    "descriptionAm" TEXT,
    "status" "ProviderStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "providerId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "titleEn" VARCHAR(200) NOT NULL,
    "titleAm" VARCHAR(200),
    "descriptionEn" TEXT NOT NULL,
    "descriptionAm" TEXT,
    "type" "ListingType" NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "price" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'ETB',
    "bedrooms" SMALLINT,
    "bathrooms" SMALLINT,
    "areaSqm" DECIMAL(12,2),
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "countryCode" CHAR(2) NOT NULL DEFAULT 'ET',
    "regionEn" VARCHAR(120) NOT NULL,
    "regionAm" VARCHAR(120),
    "cityEn" VARCHAR(120) NOT NULL,
    "cityAm" VARCHAR(120),
    "subcityEn" VARCHAR(120),
    "subcityAm" VARCHAR(120),
    "addressEn" VARCHAR(500),
    "addressAm" VARCHAR(500),
    "coordinates" geography(Point,4326),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "listingId" UUID,
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'CHAPA',
    "gatewayReference" VARCHAR(128),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "refundedAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'ETB',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "lastSeenAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "reviewerId" UUID,
    "type" "VerificationType" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "target" VARCHAR(320),
    "tokenHash" CHAR(64),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "reviewedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uploadedById" UUID NOT NULL,
    "listingId" UUID,
    "verificationId" UUID,
    "objectKey" VARCHAR(512) NOT NULL,
    "type" "MediaType" NOT NULL,
    "visibility" "MediaVisibility" NOT NULL DEFAULT 'PRIVATE',
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "altEn" VARCHAR(300),
    "altAm" VARCHAR(300),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "referrerId" UUID NOT NULL,
    "referredUserId" UUID NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "qualifiedAt" TIMESTAMPTZ(6),
    "rewardedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'SYSTEM',
    "titleEn" VARCHAR(200) NOT NULL,
    "titleAm" VARCHAR(200),
    "bodyEn" TEXT NOT NULL,
    "bodyAm" TEXT,
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- CreateIndex
CREATE INDEX "users_status_createdAt_idx" ON "users"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "providers_userId_key" ON "providers"("userId");

-- CreateIndex
CREATE INDEX "providers_status_createdAt_idx" ON "providers"("status", "createdAt");

-- CreateIndex
CREATE INDEX "listings_providerId_status_createdAt_idx" ON "listings"("providerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "listings_locationId_status_idx" ON "listings"("locationId", "status");

-- CreateIndex
CREATE INDEX "listings_status_type_propertyType_price_idx" ON "listings"("status", "type", "propertyType", "price");

-- CreateIndex
CREATE INDEX "listings_status_publishedAt_idx" ON "listings"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "locations_countryCode_regionEn_cityEn_idx" ON "locations"("countryCode", "regionEn", "cityEn");

-- CreateIndex
CREATE INDEX "locations_coordinates_idx" ON "locations" USING GIST ("coordinates");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_userId_createdAt_idx" ON "payments"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_listingId_idx" ON "payments"("listingId");

-- CreateIndex
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gateway_gatewayReference_key" ON "payments"("gateway", "gatewayReference");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "verifications_tokenHash_key" ON "verifications"("tokenHash");

-- CreateIndex
CREATE INDEX "verifications_userId_type_status_idx" ON "verifications"("userId", "type", "status");

-- CreateIndex
CREATE INDEX "verifications_reviewerId_idx" ON "verifications"("reviewerId");

-- CreateIndex
CREATE INDEX "verifications_status_expiresAt_idx" ON "verifications"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "media_objectKey_key" ON "media"("objectKey");

-- CreateIndex
CREATE INDEX "media_uploadedById_createdAt_idx" ON "media"("uploadedById", "createdAt");

-- CreateIndex
CREATE INDEX "media_listingId_position_idx" ON "media"("listingId", "position");

-- CreateIndex
CREATE INDEX "media_verificationId_idx" ON "media"("verificationId");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referredUserId_key" ON "referrals"("referredUserId");

-- CreateIndex
CREATE INDEX "referrals_referrerId_status_createdAt_idx" ON "referrals"("referrerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "verifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Prisma cannot represent these CHECK constraints; retain them in migration history.
ALTER TABLE "users"
  ADD CONSTRAINT "users_identity_check" CHECK (num_nonnulls("email", "phone") >= 1),
  ADD CONSTRAINT "users_email_check" CHECK ("email" IS NULL OR ("email" = lower(btrim("email")) AND "email" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
  ADD CONSTRAINT "users_phone_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "users_display_name_check" CHECK (length(btrim("displayName")) > 0),
  ADD CONSTRAINT "users_locale_check" CHECK ("preferredLocale" IN ('en', 'am'));

ALTER TABLE "providers"
  ADD CONSTRAINT "providers_name_check" CHECK (length(btrim("nameEn")) > 0);

ALTER TABLE "listings"
  ADD CONSTRAINT "listings_content_check" CHECK (length(btrim("titleEn")) > 0 AND length(btrim("descriptionEn")) > 0),
  ADD CONSTRAINT "listings_price_check" CHECK ("price" > 0),
  ADD CONSTRAINT "listings_dimensions_check" CHECK (("bedrooms" IS NULL OR "bedrooms" >= 0) AND ("bathrooms" IS NULL OR "bathrooms" >= 0) AND ("areaSqm" IS NULL OR "areaSqm" > 0)),
  ADD CONSTRAINT "listings_publication_check" CHECK ("status" <> 'PUBLISHED' OR ("publishedAt" IS NOT NULL AND "deletedAt" IS NULL));

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_address_check" CHECK ("countryCode" ~ '^[A-Z]{2}$' AND length(btrim("regionEn")) > 0 AND length(btrim("cityEn")) > 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check" CHECK ("amountMinor" > 0 AND "refundedAmountMinor" >= 0 AND "refundedAmountMinor" <= "amountMinor"),
  ADD CONSTRAINT "payments_reference_check" CHECK (length(btrim("idempotencyKey")) > 0 AND ("gatewayReference" IS NULL OR length(btrim("gatewayReference")) > 0));

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_token_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "sessions_expiry_check" CHECK ("expiresAt" > "createdAt");

ALTER TABLE "verifications"
  ADD CONSTRAINT "verifications_token_hash_check" CHECK ("tokenHash" IS NULL OR "tokenHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "verifications_expiry_check" CHECK ("expiresAt" > "createdAt"),
  ADD CONSTRAINT "verifications_target_check" CHECK (
    ("type" = 'IDENTITY' AND "target" IS NULL AND "tokenHash" IS NULL)
    OR ("type" IN ('EMAIL', 'PHONE') AND "target" IS NOT NULL AND length(btrim("target")) > 0 AND "tokenHash" IS NOT NULL)
  );

ALTER TABLE "media"
  ADD CONSTRAINT "media_size_check" CHECK ("sizeBytes" > 0 AND "position" >= 0),
  ADD CONSTRAINT "media_object_check" CHECK (length(btrim("objectKey")) > 0 AND length(btrim("mimeType")) > 0),
  ADD CONSTRAINT "media_target_check" CHECK (num_nonnulls("listingId", "verificationId") <= 1),
  ADD CONSTRAINT "media_verification_private_check" CHECK ("verificationId" IS NULL OR "visibility" = 'PRIVATE');

ALTER TABLE "referrals"
  ADD CONSTRAINT "referrals_no_self_check" CHECK ("referrerId" <> "referredUserId");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_content_check" CHECK (length(btrim("titleEn")) > 0 AND length(btrim("bodyEn")) > 0);

COMMIT;
