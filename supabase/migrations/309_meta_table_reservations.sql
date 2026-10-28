-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Table booking by chat. A consented Messenger customer asks in their own words; Muse Spark (or a free
-- matcher) extracts date, time and party size, and the server asks back for what is missing. A booking holds
-- a table that has a BitPOS device with an NTAG sticker. The customer checks in by tapping that sticker from
-- 15 minutes before to 15 minutes after the booked time; otherwise the booking lapses (NO_SHOW) and the
-- table is free. While a booking holds a table, other customers' taps at that table are refused.
-- The inherited table and occupancy tables are only read, never written.
SET search_path TO bitpos,extensions,public;

CREATE TABLE meta_table_reservations(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 link_id uuid NOT NULL,
 table_id uuid NOT NULL,
 party_size int NOT NULL CHECK(party_size BETWEEN 1 AND 12),
 starts_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'HELD' CHECK(status IN ('HELD','CHECKED_IN','NO_SHOW','CANCELLED')),
 checked_in_at timestamptz,
 tap_session_id uuid,
 cancelled_at timestamptz,
 cancelled_by text CHECK(cancelled_by IN ('customer','staff')),
 lapse_notified_at timestamptz,
 chosen_by text NOT NULL CHECK(chosen_by IN ('model','fallback')),
 invocation_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,link_id) REFERENCES meta_customer_links(merchant_id,id),
 FOREIGN KEY(merchant_id,table_id) REFERENCES merchant_tables(merchant_id,id),
 FOREIGN KEY(merchant_id,tap_session_id) REFERENCES meta_tap_sessions(merchant_id,id),
 FOREIGN KEY(merchant_id,invocation_id) REFERENCES meta_ai_invocations(merchant_id,id),
 CHECK((status='CHECKED_IN')=(checked_in_at IS NOT NULL AND tap_session_id IS NOT NULL)),
 CHECK((status='CANCELLED')=(cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
 CHECK(checked_in_at IS NULL OR (checked_in_at>=starts_at-interval '15 minutes' AND checked_in_at<=starts_at+interval '15 minutes')),
 CHECK(starts_at>created_at AND starts_at<=created_at+interval '14 days')
);
CREATE INDEX meta_reservation_table_time ON meta_table_reservations(merchant_id,table_id,starts_at) WHERE status IN ('HELD','CHECKED_IN');
CREATE INDEX meta_reservation_link ON meta_table_reservations(merchant_id,link_id,starts_at DESC);

-- What a customer has said so far, until the booking can be made (30 minutes).
CREATE TABLE meta_booking_requests(
 merchant_id uuid NOT NULL REFERENCES merchants,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 link_id uuid NOT NULL,
 booking_date date,
 booking_time time,
 party_size int CHECK(party_size BETWEEN 1 AND 12),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 closed_at timestamptz,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,link_id) REFERENCES meta_customer_links(merchant_id,id),
 -- Sliding: each new answer extends the request by 30 minutes from that moment.
 CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX meta_booking_request_open ON meta_booking_requests(merchant_id,link_id) WHERE closed_at IS NULL;

ALTER TABLE meta_table_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_booking_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_reservation_tenant ON meta_table_reservations USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
CREATE POLICY meta_booking_request_tenant ON meta_booking_requests USING(merchant_id::text=current_setting('bitpos.merchant',true)) WITH CHECK(merchant_id::text=current_setting('bitpos.merchant',true));
GRANT SELECT,INSERT ON meta_table_reservations,meta_booking_requests TO bitpos_app;
GRANT UPDATE(status,checked_in_at,tap_session_id,cancelled_at,cancelled_by,lapse_notified_at) ON meta_table_reservations TO bitpos_app;
GRANT UPDATE(booking_date,booking_time,party_size,expires_at,closed_at) ON meta_booking_requests TO bitpos_app;

-- The lapse sweeper only learns which shops have bookings past their check-in window; it then works per tenant.
CREATE FUNCTION bitpos.meta_lapsed_reservation_merchants() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT DISTINCT merchant_id FROM meta_table_reservations WHERE status='HELD' AND starts_at+interval '15 minutes'<clock_timestamp() $$;
REVOKE ALL ON FUNCTION bitpos.meta_lapsed_reservation_merchants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_lapsed_reservation_merchants() TO bitpos_app;
