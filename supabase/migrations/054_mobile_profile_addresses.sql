-- Additive account-only profile/address authority. No merchant CRM merge.
-- Rollback: disable mobile admission; retain private address/command history.
SET search_path TO bitpos,public;
ALTER TABLE mobile_accounts ADD COLUMN profile_version bigint NOT NULL DEFAULT 1 CHECK(profile_version>0);
CREATE TABLE mobile_addresses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES mobile_accounts,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 label text NOT NULL CHECK(char_length(label) BETWEEN 1 AND 80),
 recipient_name text NOT NULL CHECK(char_length(recipient_name) BETWEEN 1 AND 80),
 phone text NOT NULL CHECK(phone ~ '^\+[1-9][0-9]{7,14}$'),
 address_text text NOT NULL CHECK(char_length(address_text) BETWEEN 1 AND 1000),
 instructions text NOT NULL CHECK(char_length(instructions)<=500),
 latitude_e7 integer CHECK(latitude_e7 BETWEEN -900000000 AND 900000000),
 longitude_e7 integer CHECK(longitude_e7 BETWEEN -1800000000 AND 1800000000),
 archived boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((latitude_e7 IS NULL)=(longitude_e7 IS NULL)),
 UNIQUE(account_id,id)
);
CREATE INDEX mobile_addresses_account_active ON mobile_addresses(account_id,id) WHERE NOT archived;
CREATE TABLE mobile_account_commands(
 account_id uuid NOT NULL REFERENCES mobile_accounts,
 idempotency_key uuid NOT NULL,
 operation text NOT NULL,
 request_hash text NOT NULL CHECK(length(request_hash)=64),
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,idempotency_key)
);
REVOKE ALL ON mobile_addresses,mobile_account_commands FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON mobile_addresses TO bitpos_app;
GRANT SELECT,INSERT ON mobile_account_commands TO bitpos_app;
ALTER TABLE mobile_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_addresses FORCE ROW LEVEL SECURITY;
CREATE POLICY mobile_address_owner ON mobile_addresses TO bitpos_app
 USING(account_id::text=current_setting('bitpos.mobile_account',true))
 WITH CHECK(account_id::text=current_setting('bitpos.mobile_account',true));
ALTER TABLE mobile_account_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_account_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY mobile_account_command_owner ON mobile_account_commands TO bitpos_app
 USING(account_id::text=current_setting('bitpos.mobile_account',true))
 WITH CHECK(account_id::text=current_setting('bitpos.mobile_account',true));
