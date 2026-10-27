-- Merchant-private CRM and bounded raster avatar; financial identity remains unchanged.
SET search_path=bitpos,public;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS crm jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE customers ADD CONSTRAINT customer_crm_size CHECK (jsonb_typeof(crm)='object' AND octet_length(crm::text)<=16000);
ALTER TABLE customers ADD CONSTRAINT customer_avatar_size CHECK (jsonb_typeof(avatar)='object' AND octet_length(avatar::text)<=150000);
