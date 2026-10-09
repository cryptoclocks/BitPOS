SET search_path TO bitpos, public;
-- Explicit user authorization 2026-10-08: controlled devnet verification only.
-- Observed sponsor98,830,000 lamports;80M/day remains funded and bounded.
-- Preserve every existing reservation.1M/order and3payer attempts/minute unchanged.
ALTER TABLE sponsor_days DROP CONSTRAINT sponsor_days_reserved_lamports_check;
ALTER TABLE sponsor_days ADD CONSTRAINT sponsor_days_reserved_lamports_check CHECK(reserved_lamports BETWEEN 0 AND 80000000);
