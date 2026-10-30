-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
-- Booking reminder: when a held table's check-in window opens (5 minutes before the booked time) the customer gets
-- one Messenger reminder; reminded_at makes it once only, even across restarts and duplicate sweeps.
ALTER TABLE bitpos.meta_table_reservations ADD COLUMN reminded_at timestamptz;
GRANT UPDATE(reminded_at) ON bitpos.meta_table_reservations TO bitpos_app;
CREATE FUNCTION bitpos.meta_due_reminder_merchants() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=bitpos,pg_temp AS $$
 SELECT DISTINCT merchant_id FROM meta_table_reservations WHERE status='HELD' AND reminded_at IS NULL
  AND starts_at-interval '5 minutes'<=clock_timestamp() AND starts_at+interval '15 minutes'>=clock_timestamp() $$;
REVOKE ALL ON FUNCTION bitpos.meta_due_reminder_merchants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitpos.meta_due_reminder_merchants() TO bitpos_app;
