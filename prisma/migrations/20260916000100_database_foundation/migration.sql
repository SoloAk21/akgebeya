BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS "akgebeya_foundation";

CREATE TABLE "akgebeya_foundation"."foundation_probe" (
    "id" VARCHAR(32) NOT NULL,
    "message" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "foundation_probe_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "foundation_probe_singleton" CHECK ("id" = 'foundation'),
    CONSTRAINT "foundation_probe_message_nonempty" CHECK (length(btrim("message")) > 0)
);

COMMIT;
