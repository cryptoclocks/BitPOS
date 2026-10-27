-- Account-owned favourite branches. Local preparation only; no actual-use migration.
SET search_path TO bitpos,public;
CREATE TABLE mobile_favourite_branches(
 account_id uuid NOT NULL REFERENCES mobile_accounts,
 merchant_id uuid NOT NULL,
 branch_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,branch_id),
 FOREIGN KEY(merchant_id,branch_id) REFERENCES marketplace_branches(merchant_id,id)
);
ALTER TABLE mobile_favourite_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_favourite_branches FORCE ROW LEVEL SECURITY;
CREATE POLICY own_favourites ON mobile_favourite_branches
 USING(account_id=NULLIF(current_setting('bitpos.mobile_account',true),'')::uuid)
 WITH CHECK(account_id=NULLIF(current_setting('bitpos.mobile_account',true),'')::uuid);
GRANT SELECT,INSERT,DELETE ON mobile_favourite_branches TO bitpos_app;
