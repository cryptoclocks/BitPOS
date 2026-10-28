-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- BitPOS Mini Meta product: a counter bill can be shown on one device (its Stripe QR), and the device asks the
-- server which screen to show. The device authenticates with a key derived from the tap master key and its id;
-- this function only maps an active device to its shop before tenant context exists.
SET search_path TO bitpos,extensions,public;

ALTER TABLE meta_cart_orders ADD COLUMN device_id uuid;
ALTER TABLE meta_cart_orders ADD CONSTRAINT meta_cart_orders_device_fkey FOREIGN KEY(merchant_id,device_id) REFERENCES devices(merchant_id,id);
CREATE INDEX meta_cart_order_device ON meta_cart_orders(merchant_id,device_id,created_at DESC) WHERE device_id IS NOT NULL;

CREATE FUNCTION bitpos.meta_device_merchant(p_device_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT merchant_id FROM devices WHERE id=p_device_id AND revoked_at IS NULL $$;
REVOKE ALL ON FUNCTION bitpos.meta_device_merchant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_device_merchant(uuid) TO bitpos_app;
