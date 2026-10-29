-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Messenger can now pay a multi-item cart (design C08/C09): a cart order with channel 'chat' belongs to a consented
-- Messenger link, so the paid receipt goes back to that chat. Prices are still taken by the server when the order is made.
SET search_path TO bitpos,extensions,public;

ALTER TABLE meta_cart_orders DROP CONSTRAINT meta_cart_orders_channel_check;
ALTER TABLE meta_cart_orders ADD CONSTRAINT meta_cart_orders_channel_check CHECK(channel IN ('table','counter','web','chat'));
ALTER TABLE meta_cart_orders ADD CONSTRAINT meta_cart_orders_chat_link CHECK(channel<>'chat' OR link_id IS NOT NULL);
CREATE INDEX meta_cart_order_link ON meta_cart_orders(merchant_id,link_id,created_at DESC) WHERE link_id IS NOT NULL;
