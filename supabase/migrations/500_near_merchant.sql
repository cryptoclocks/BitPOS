-- NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
-- Per-shop NEAR settings for the Living Bill: the shop's NEAR account, the token it is paid in, the split recipe,
-- who gets paid (staff on shift, tax reserve, suppliers with open invoices) and the witness devices.
-- Testnet only: mainnet is impossible at the schema level until a later, separately authorised migration.
SET search_path TO bitpos,extensions,public;

CREATE TABLE near_merchant_settings(
 merchant_id uuid PRIMARY KEY REFERENCES merchants,
 enabled boolean NOT NULL DEFAULT false,
 network text NOT NULL DEFAULT 'testnet' CHECK(network='testnet'),
 near_account text NOT NULL CHECK(near_account ~ '^[a-z0-9._-]{2,64}$'),
 token_contract text NOT NULL CHECK(token_contract ~ '^[a-z0-9._-]{2,64}$'),
 token_symbol text NOT NULL CHECK(token_symbol ~ '^[A-Za-z0-9]{2,8}$'),
 token_decimals smallint NOT NULL DEFAULT 6 CHECK(token_decimals=6),
 tax_bps integer NOT NULL DEFAULT 700 CHECK(tax_bps BETWEEN 0 AND 3000),
 tips_bps integer NOT NULL DEFAULT 1000 CHECK(tips_bps BETWEEN 0 AND 3000),
 witness_device_id uuid,
 witness_timeout_s integer NOT NULL DEFAULT 120 CHECK(witness_timeout_s BETWEEN 30 AND 3600),
 max_bill_units bigint NOT NULL DEFAULT 1000000000 CHECK(max_bill_units BETWEEN 1 AND 100000000000),
 updated_by text NOT NULL CHECK(length(updated_by) BETWEEN 1 AND 200),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- People and businesses a bill can pay besides the owner. `on_shift_since` is the clock-in time of staff.
CREATE TABLE near_recipients(
 merchant_id uuid NOT NULL REFERENCES near_merchant_settings(merchant_id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('staff','supplier','tax')),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
 near_account text NOT NULL CHECK(near_account ~ '^[a-z0-9._-]{2,64}$'),
 weight integer NOT NULL DEFAULT 1 CHECK(weight BETWEEN 1 AND 10),
 active boolean NOT NULL DEFAULT true,
 on_shift_since timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,kind,near_account),
 CHECK(on_shift_since IS NULL OR kind='staff')
);
CREATE UNIQUE INDEX near_one_tax_recipient ON near_recipients(merchant_id) WHERE kind='tax' AND active;

-- A supplier invoice that collects itself: every paid bill sends `rate_bps` of its total to the supplier until
-- the invoice is funded. Amounts are token units (6 decimals).
CREATE TABLE near_supplier_invoices(
 merchant_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 recipient_id uuid NOT NULL,
 reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 60),
 total_units bigint NOT NULL CHECK(total_units BETWEEN 1 AND 100000000000),
 funded_units bigint NOT NULL DEFAULT 0 CHECK(funded_units>=0),
 rate_bps integer NOT NULL CHECK(rate_bps BETWEEN 1 AND 3000),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','FUNDED','CANCELLED')),
 due_on date,
 created_by text NOT NULL CHECK(length(created_by) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 funded_at timestamptz,
 PRIMARY KEY(merchant_id,id),
 UNIQUE(merchant_id,reference),
 FOREIGN KEY(merchant_id,recipient_id) REFERENCES near_recipients(merchant_id,id),
 CHECK(funded_units<=total_units),
 CHECK((status='FUNDED')=(funded_units=total_units))
);

-- Witness devices: a BitPOS Mini (firmware product "near") or a labelled simulated screen in a browser.
-- The device's ed25519 key is made on the device; only the public half is stored here.
CREATE TABLE near_devices(
 merchant_id uuid NOT NULL REFERENCES near_merchant_settings(merchant_id),
 id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
 kind text NOT NULL CHECK(kind IN ('mini','browser')),
 key_hash text NOT NULL CHECK(key_hash ~ '^[0-9a-f]{64}$'),
 public_key_hex text CHECK(public_key_hex ~ '^[0-9a-f]{64}$'),
 registered_at timestamptz,
 last_seen_at timestamptz,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 CHECK((public_key_hex IS NULL)=(registered_at IS NULL))
);
ALTER TABLE near_merchant_settings ADD FOREIGN KEY(merchant_id,witness_device_id) REFERENCES near_devices(merchant_id,id);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['near_merchant_settings','near_recipients','near_supplier_invoices','near_devices'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO bitpos_app USING(merchant_id::text=current_setting(''bitpos.merchant'',true)) WITH CHECK(merchant_id::text=current_setting(''bitpos.merchant'',true))',t);
 END LOOP;
END $$;
-- The shop's NEAR account, token and network are set by seed, never from a screen; the recipe is editable.
GRANT SELECT ON near_merchant_settings TO bitpos_app;
GRANT UPDATE(tax_bps,tips_bps,witness_device_id,witness_timeout_s,updated_by,updated_at) ON near_merchant_settings TO bitpos_app;
GRANT SELECT,INSERT,UPDATE ON near_recipients,near_supplier_invoices,near_devices TO bitpos_app;

-- A device calls in with only its id and bearer key: resolve the shop without a tenant context, returning ids only.
CREATE FUNCTION bitpos.near_resolve_device(p_device uuid,p_key_hash text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT d.merchant_id FROM bitpos.near_devices d WHERE d.id=p_device AND d.key_hash=p_key_hash AND d.active;
$$;
REVOKE ALL ON FUNCTION bitpos.near_resolve_device(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.near_resolve_device(uuid,text) TO bitpos_app;
