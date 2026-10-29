-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Kitchen stages for paid Meta orders (tap, agent and cart orders) in the meta-pos order center: received → preparing
-- → ready; "collected" stays the order's own hand-over. Ready may notify the customer once in Messenger
-- (consented links only); ready_notified_at makes that notice happen once.
SET search_path TO bitpos,extensions,public;

CREATE TABLE meta_order_kitchen(
 merchant_id uuid NOT NULL REFERENCES merchants,
 order_id uuid NOT NULL,
 order_kind text NOT NULL CHECK(order_kind IN ('tap','agent','cart')),
 stage text NOT NULL CHECK(stage IN ('PREPARING','READY')),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_by uuid NOT NULL,
 ready_notified_at timestamptz,
 PRIMARY KEY(merchant_id,order_id)
);
ALTER TABLE meta_order_kitchen ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_order_kitchen_tenant ON meta_order_kitchen USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON meta_order_kitchen TO bitpos_app;
GRANT UPDATE(stage,updated_at,updated_by,ready_notified_at) ON meta_order_kitchen TO bitpos_app;
