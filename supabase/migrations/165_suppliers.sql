-- Shop suppliers: a plain directory the owner/manager keeps (who supplies what, how to reach them). Rows are deactivated, never
-- deleted. It is not purchasing: no orders, prices or stock are linked to it.
SET search_path TO bitpos,extensions,public;
CREATE TABLE suppliers(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 supplies text NOT NULL DEFAULT '' CHECK(length(supplies)<=200),
 contact text NOT NULL DEFAULT '' CHECK(length(contact)<=120),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=40),
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>=1),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,idempotency_key)
);
CREATE INDEX suppliers_updated ON suppliers(merchant_id,updated_at DESC,id DESC);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON suppliers FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE ON suppliers TO bitpos_app;
