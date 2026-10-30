-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Single-item chat orders (meta_agent_orders with a customer link) paid while the customer holds a booking become
-- that table's pre-order, exactly like chat-cart orders (migration 325): kept out of the kitchen until check-in.
SET search_path TO bitpos,extensions,public;
ALTER TABLE meta_agent_orders ADD COLUMN reservation_id uuid;
ALTER TABLE meta_agent_orders ADD CONSTRAINT meta_agent_orders_reservation_fk FOREIGN KEY(merchant_id,reservation_id) REFERENCES meta_table_reservations(merchant_id,id);
CREATE INDEX meta_agent_orders_reservation ON meta_agent_orders(merchant_id,reservation_id) WHERE reservation_id IS NOT NULL;
GRANT UPDATE(reservation_id) ON meta_agent_orders TO bitpos_app;
