-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- The customer's current chat cart (Messenger and the voice page share it), so a conversation can change it step by
-- step ("make it iced", "one more", "remove the croissant"). Only product ids and quantities; the server prices it each time.
SET search_path TO bitpos,extensions,public;
CREATE TABLE meta_chat_carts(
 merchant_id uuid NOT NULL REFERENCES merchants,
 link_id uuid NOT NULL,
 cart text NOT NULL CHECK(cart ~ '^([0-9a-f-]{36}:[0-9]{1,2}(,[0-9a-f-]{36}:[0-9]{1,2}){0,9})?$'),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,link_id),
 FOREIGN KEY(merchant_id,link_id) REFERENCES meta_customer_links(merchant_id,id)
);
ALTER TABLE meta_chat_carts ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_chat_cart_tenant ON meta_chat_carts USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON meta_chat_carts TO bitpos_app;
