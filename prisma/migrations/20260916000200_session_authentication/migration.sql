BEGIN;

CREATE TABLE "akgebeya_foundation"."account" (
  "id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "passwordHash" VARCHAR(256) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_email_canonical" CHECK ("email" = lower(btrim("email")))
);
CREATE UNIQUE INDEX "account_email_key" ON "akgebeya_foundation"."account"("email");

CREATE TABLE "akgebeya_foundation"."session" (
  "tokenHash" CHAR(64) NOT NULL,
  "accountId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("tokenHash"),
  CONSTRAINT "session_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "akgebeya_foundation"."account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "session_accountId_idx" ON "akgebeya_foundation"."session"("accountId");
CREATE INDEX "session_expiresAt_idx" ON "akgebeya_foundation"."session"("expiresAt");

CREATE TABLE "akgebeya_foundation"."auth_attempt" (
  "key" CHAR(64) NOT NULL,
  "count" INTEGER NOT NULL CHECK ("count" > 0),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "auth_attempt_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "auth_attempt_expiresAt_idx" ON "akgebeya_foundation"."auth_attempt"("expiresAt");

COMMIT;
