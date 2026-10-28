-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Owner approval and "Allow All" for promotion drafts. Muse Spark drafts a product offer (product, percent
-- and duration chosen from server-built lists; no prices). The owner approves the first one; approving with
-- Allow All creates a bounded policy (same product or category, percent and duration no higher than approved,
-- daily cap) under which later drafts are approved automatically and listed for the owner, who can stop any
-- offer or revoke the policy at once. Approved offers are written through the inherited product-offer
-- command, which stays authoritative; the camera-based tables of migration 300 are not used.
SET search_path TO bitpos,extensions,public;

CREATE TABLE meta_allow_all_policies(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 scope_kind text NOT NULL CHECK(scope_kind IN ('product','category')),
 product_id uuid,
 category text CHECK(char_length(category) BETWEEN 1 AND 80),
 max_discount_percent int NOT NULL CHECK(max_discount_percent BETWEEN 1 AND 50),
 max_duration_hours int NOT NULL CHECK(max_duration_hours BETWEEN 1 AND 72),
 daily_limit int NOT NULL CHECK(daily_limit BETWEEN 1 AND 10),
 created_from_draft uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz,
 revoked_by uuid,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 CHECK((scope_kind='product')=(product_id IS NOT NULL)),
 CHECK((scope_kind='category')=(category IS NOT NULL)),
 CHECK((revoked_at IS NULL)=(revoked_by IS NULL))
);
CREATE UNIQUE INDEX meta_allow_all_active ON meta_allow_all_policies(merchant_id,scope_kind,coalesce(product_id::text,category)) WHERE revoked_at IS NULL;

CREATE TABLE meta_offer_drafts(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 product_id uuid NOT NULL,
 category text CHECK(char_length(category) BETWEEN 1 AND 80),
 discount_percent int NOT NULL CHECK(discount_percent BETWEEN 1 AND 50),
 duration_hours int NOT NULL CHECK(duration_hours BETWEEN 1 AND 72),
 reason_th text NOT NULL CHECK(char_length(reason_th) BETWEEN 1 AND 200),
 reason_en text NOT NULL CHECK(char_length(reason_en) BETWEEN 1 AND 200),
 chosen_by text NOT NULL CHECK(chosen_by IN ('model','fallback')),
 invocation_id uuid,
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','APPLIED','REJECTED','EXPIRED','FAILED','STOPPED')),
 approval_kind text CHECK(approval_kind IN ('owner','policy')),
 policy_id uuid,
 decided_by uuid,
 decided_at timestamptz,
 price_version_id uuid,
 offer_revision text CHECK(offer_revision ~ '^[0-9]{1,18}$'),
 offer_expires_at timestamptz,
 failure text CHECK(failure ~ '^[A-Z_]{2,60}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 FOREIGN KEY(merchant_id,invocation_id) REFERENCES meta_ai_invocations(merchant_id,id),
 FOREIGN KEY(merchant_id,policy_id) REFERENCES meta_allow_all_policies(merchant_id,id),
 CHECK((chosen_by='model')=(invocation_id IS NOT NULL)),
 CHECK((approval_kind='policy')=(policy_id IS NOT NULL)),
 CHECK(state NOT IN ('APPLIED','STOPPED') OR (approval_kind IS NOT NULL AND decided_by IS NOT NULL AND offer_revision IS NOT NULL AND price_version_id IS NOT NULL AND offer_expires_at IS NOT NULL)),
 CHECK(state<>'FAILED' OR failure IS NOT NULL),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '1 hour')
);
CREATE INDEX meta_offer_draft_recent ON meta_offer_drafts(merchant_id,created_at DESC);
-- One open draft per product at a time (double clicks, retries).
CREATE UNIQUE INDEX meta_offer_draft_open ON meta_offer_drafts(merchant_id,product_id) WHERE state='DRAFT';

ALTER TABLE meta_allow_all_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_offer_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_allow_all_tenant ON meta_allow_all_policies USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_offer_draft_tenant ON meta_offer_drafts USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON meta_allow_all_policies,meta_offer_drafts TO bitpos_app;
GRANT UPDATE(revoked_at,revoked_by) ON meta_allow_all_policies TO bitpos_app;
GRANT UPDATE(state,approval_kind,policy_id,decided_by,decided_at,price_version_id,offer_revision,offer_expires_at,failure) ON meta_offer_drafts TO bitpos_app;
