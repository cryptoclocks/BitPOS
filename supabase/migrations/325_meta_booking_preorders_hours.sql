-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- 1. Pre-orders for a booked table: a chat-cart order paid while its customer holds a booking is tied to that booking
--    (reservation_id). It stays out of the kitchen queue until the customer checks in at the table. If the booking
--    lapses or is cancelled the order is not refunded (shop policy); staff still see it.
-- 2. Booking settings per shop: slot length (15/30/60 minutes) and how many minutes before closing the last booking
--    may start. Opening hours come from merchant_opening_hours (migration 138); without them 10:00-22:00 is used.
SET search_path TO bitpos,extensions,public;
ALTER TABLE meta_cart_orders ADD COLUMN reservation_id uuid;
ALTER TABLE meta_cart_orders ADD CONSTRAINT meta_cart_orders_reservation_fk FOREIGN KEY(merchant_id,reservation_id) REFERENCES meta_table_reservations(merchant_id,id);
CREATE INDEX meta_cart_orders_reservation ON meta_cart_orders(merchant_id,reservation_id) WHERE reservation_id IS NOT NULL;
GRANT UPDATE(reservation_id) ON meta_cart_orders TO bitpos_app;

CREATE TABLE meta_booking_settings(
 merchant_id uuid PRIMARY KEY REFERENCES merchants,
 slot_minutes integer NOT NULL DEFAULT 30 CHECK(slot_minutes IN (15,30,60)),
 last_booking_before_close_minutes integer NOT NULL DEFAULT 60 CHECK(last_booking_before_close_minutes BETWEEN 0 AND 240),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_by uuid
);
ALTER TABLE meta_booking_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON meta_booking_settings FOR ALL TO bitpos_app USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT,UPDATE ON meta_booking_settings TO bitpos_app;
