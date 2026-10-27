-- Additive mobile identity boundary. No merchant membership is granted here.
-- Rollback: disable mobile admission; retain accounts/session audit and CRM links.
SET search_path TO bitpos,public;
CREATE TABLE mobile_accounts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 auth_subject uuid NOT NULL UNIQUE,
 display_name text NOT NULL DEFAULT '' CHECK(octet_length(display_name)<=320),
 locale text NOT NULL DEFAULT 'th' CHECK(locale IN ('th','en')),
 disabled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE mobile_sessions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES mobile_accounts,
 device_id uuid NOT NULL,
 access_hash text NOT NULL UNIQUE,
 refresh_hash text NOT NULL UNIQUE,
 access_expires_at timestamptz NOT NULL,
 refresh_expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(refresh_expires_at>access_expires_at)
);
CREATE INDEX mobile_sessions_account ON mobile_sessions(account_id);
CREATE TABLE mobile_refresh_history(
 token_hash text PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES mobile_sessions,
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE mobile_identity_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id uuid REFERENCES mobile_accounts,
 session_id uuid REFERENCES mobile_sessions,
 action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE mobile_customer_links(
 account_id uuid NOT NULL REFERENCES mobile_accounts,
 merchant_id uuid NOT NULL REFERENCES merchants,
 customer_id uuid NOT NULL,
 linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,merchant_id),
 UNIQUE(merchant_id,customer_id),
 FOREIGN KEY(merchant_id,customer_id) REFERENCES customers(merchant_id,id)
);
CREATE TABLE mobile_auth_limits(
 bucket_hash text NOT NULL,
 window_start timestamptz NOT NULL,
 attempts integer NOT NULL CHECK(attempts>0),
 PRIMARY KEY(bucket_hash,window_start)
);
-- API is the only account authority. Browser/Supabase anon never gets table access.
REVOKE ALL ON mobile_accounts,mobile_sessions,mobile_refresh_history,mobile_identity_audit,mobile_customer_links,mobile_auth_limits FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON mobile_accounts,mobile_sessions,mobile_auth_limits TO bitpos_app;
GRANT SELECT,INSERT ON mobile_refresh_history,mobile_identity_audit,mobile_customer_links TO bitpos_app;
GRANT USAGE,SELECT ON SEQUENCE mobile_identity_audit_id_seq TO bitpos_app;
ALTER TABLE mobile_customer_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY mobile_link_tenant ON mobile_customer_links TO bitpos_app
 USING(merchant_id::text=current_setting('bitpos.merchant',true))
 WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
