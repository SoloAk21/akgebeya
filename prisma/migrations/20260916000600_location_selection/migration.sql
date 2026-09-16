-- Add one private, confirmed map selection per account. Existing schemas/data are untouched.
-- Resolve the installed PostGIS namespace instead of assuming the connection search path.
DO $migration$
DECLARE postgis_schema text;
BEGIN
  SELECT n.nspname INTO STRICT postgis_schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'postgis';
  EXECUTE format($table$
    CREATE TABLE akgebeya_foundation.account_location (
      "accountId" uuid PRIMARY KEY REFERENCES akgebeya_foundation.account(id) ON DELETE CASCADE,
      "countryId" varchar(2) NOT NULL,
      "regionId" varchar(40) NOT NULL,
      "cityId" varchar(40) NOT NULL,
      "subcityId" varchar(40) NOT NULL,
      latitude double precision NOT NULL,
      longitude double precision NOT NULL,
      confirmed boolean NOT NULL,
      point %1$I.geometry(Point,4326) GENERATED ALWAYS AS
        (%1$I.ST_SetSRID(%1$I.ST_MakePoint(longitude, latitude), 4326)) STORED NOT NULL,
      "updatedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT account_location_hierarchy_check CHECK (
        "countryId" = 'ET' AND "regionId" = 'addis-ababa' AND "cityId" = 'addis-ababa-city'
        AND "subcityId" IN ('addis-ketema', 'akaki-kality', 'arada', 'bole', 'gulele', 'kirkos',
          'kolfe-keranio', 'lideta', 'nifas-silk-lafto', 'yeka', 'lemi-kura')),
      -- This rectangle is initial service coverage, not a city/subcity boundary polygon.
      CONSTRAINT account_location_service_area_check CHECK (
        latitude BETWEEN 8.8 AND 9.15 AND longitude BETWEEN 38.6 AND 39.0),
      CONSTRAINT account_location_confirmation_check CHECK (confirmed = true)
    )
  $table$, postgis_schema);
END
$migration$;
