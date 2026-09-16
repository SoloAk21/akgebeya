ALTER TABLE akgebeya_foundation.account_location
  ADD COLUMN address jsonb,
  ADD CONSTRAINT account_location_address_object_check CHECK (address IS NULL OR jsonb_typeof(address) = 'object');
